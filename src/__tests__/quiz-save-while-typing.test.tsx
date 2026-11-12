/**
 * Quiz fields save while they are written, not only when they are left.
 *
 * They used to save on blur and nowhere else, so closing the dialog with Esc or
 * a swipe while still in a field, or closing the tab, lost the last edit. Now a
 * field saves SAVE_WHILE_TYPING_MS after typing stops, on blur, and when the
 * dialog closes on it (unmount). A save that lands while the author is still
 * typing must not put the older text back.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import type { QuizQuestionAuthored } from "../lib/api-learning-quizzes";

/** The server's copy of the question, mutated by the mocked writes. */
let server: QuizQuestionAuthored;

const clone = (q: QuizQuestionAuthored): QuizQuestionAuthored => JSON.parse(JSON.stringify(q));

vi.mock("../lib/api-learning-quizzes", () => ({
  createQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(),
  getQuizAsAuthor: vi.fn(),
  reorderQuizQuestions: vi.fn(),
  updateQuiz: vi.fn(),
  updateQuizQuestion: vi.fn(async (_id: string, patch: Partial<QuizQuestionAuthored>) => {
    server = { ...server, ...patch };
  }),
  replaceQuizOptions: vi.fn(async (_id: string, options: { label: string; isCorrect: boolean }[]) => {
    server = {
      ...server,
      options: options.map((o, i) => ({ id: `opt-${i}-${o.label}`, label: o.label.trim(), isCorrect: o.isCorrect, order: i })),
    };
  }),
}));

// eslint-disable-next-line import/first
import { QuestionEditor } from "../components/QuizEditor.client";
// eslint-disable-next-line import/first
import { replaceQuizOptions, updateQuizQuestion } from "../lib/api-learning-quizzes";
// eslint-disable-next-line import/first
import { SAVE_WHILE_TYPING_MS } from "../lib/useSaveWhileTyping";

/** The lesson dialog's role: owns the question and re-reads it after a write. */
function Harness() {
  const [question, setQuestion] = useState(() => clone(server));
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QuestionEditor
        question={question}
        busy={false}
        run={async (fn) => {
          await fn();
          return true;
        }}
        refresh={async () => setQuestion(clone(server))}
        onBack={() => {}}
      />
    </NextIntlClientProvider>
  );
}

/** Let the mocked writes and the re-read that follows them resolve. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

const prompt = () => screen.getByPlaceholderText("What do you want to ask?") as HTMLTextAreaElement;
const answers = () => screen.getAllByPlaceholderText("An answer") as HTMLInputElement[];

beforeEach(() => {
  vi.useFakeTimers();
  server = {
    id: "q1",
    prompt: "New question",
    order: 0,
    feedback: null,
    options: [
      { id: "a", label: "A process that removes material", isCorrect: true, order: 0 },
      { id: "b", label: "A method for scanning", isCorrect: false, order: 1 },
    ],
  };
  vi.mocked(updateQuizQuestion).mockClear();
  vi.mocked(replaceQuizOptions).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quiz question fields save while typing", () => {
  it("saves the question a moment after typing stops, without leaving the field", async () => {
    render(<Harness />);
    fireEvent.change(prompt(), { target: { value: "What is 3D printing?" } });
    expect(updateQuizQuestion).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); });
    await settle();
    expect(updateQuizQuestion).toHaveBeenCalledWith("q1", { prompt: "What is 3D printing?" });
  });

  it("closing the dialog while still in the field saves it (Esc / swipe / X)", async () => {
    const { unmount } = render(<Harness />);
    fireEvent.change(prompt(), { target: { value: "What is 3D printing?" } });
    unmount();
    await settle();
    expect(updateQuizQuestion).toHaveBeenCalledWith("q1", { prompt: "What is 3D printing?" });
  });

  it("saves once for a burst of typing, not per keystroke", async () => {
    render(<Harness />);
    for (const value of ["W", "Wh", "Wha", "What"]) {
      fireEvent.change(prompt(), { target: { value } });
      act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS / 4); });
    }
    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); });
    await settle();
    expect(updateQuizQuestion).toHaveBeenCalledTimes(1);
    expect(updateQuizQuestion).toHaveBeenCalledWith("q1", { prompt: "What" });
  });

  it("a save that lands mid-typing does not put the older text back", async () => {
    render(<Harness />);
    fireEvent.change(prompt(), { target: { value: "What is" } });
    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); }); // "What is" is now saving
    fireEvent.change(prompt(), { target: { value: "What is 3D" } }); // still typing
    await settle(); // the save and its re-read land
    expect(prompt().value).toBe("What is 3D");
  });

  it("keeps a trailing space while typing (no 'word' + 'next' glued together)", async () => {
    render(<Harness />);
    fireEvent.change(prompt(), { target: { value: "What is " } });
    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); });
    await settle();
    expect(updateQuizQuestion).toHaveBeenCalledWith("q1", { prompt: "What is" });
    expect(prompt().value).toBe("What is ");
  });
});

describe("quiz answers save while typing", () => {
  it("an answer edited and the dialog closed is saved", async () => {
    const { unmount } = render(<Harness />);
    fireEvent.change(answers()[1], { target: { value: "A process that builds objects layer by layer" } });
    unmount();
    await settle();
    expect(replaceQuizOptions).toHaveBeenCalledWith("q1", [
      { label: "A process that removes material", isCorrect: true },
      { label: "A process that builds objects layer by layer", isCorrect: false },
    ]);
  });

  it("an answer saves a moment after typing stops, and the input keeps the cursor's text", async () => {
    render(<Harness />);
    fireEvent.change(answers()[1], { target: { value: "Additive " } });
    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); });
    await settle();
    expect(replaceQuizOptions).toHaveBeenCalledTimes(1);
    expect(answers()[1].value).toBe("Additive ");
  });

  it("a just-added empty answer is not sent, and survives the re-read", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Add an answer"));
    expect(answers()).toHaveLength(3);
    fireEvent.change(answers()[0], { target: { value: "Subtractive" } });
    act(() => { vi.advanceTimersByTime(SAVE_WHILE_TYPING_MS); });
    await settle();
    const sent = vi.mocked(replaceQuizOptions).mock.calls[0][1];
    expect(sent).toHaveLength(2);
    expect(answers()).toHaveLength(3);
  });
});
