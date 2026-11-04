/*
 * T-101: a write that fails must SAY SO.
 *
 * useBusy had no catch. A rejected save cleared the busy flag in `finally`, the
 * spinner stopped, the controls came back, and the builder looked exactly as it
 * does after a successful save — while the rejection went to the console as an
 * unhandled promise rejection, somewhere the author is not looking.
 *
 * The cost is not a missing toast. The author keeps editing a document the
 * server never received, builds more on top of it, and discovers it on reload.
 * Of the twenty-odd write sites in the builder, only the two upload paths had
 * their own try/catch; everything else failed in silence.
 *
 * These render the real builder and make a real write reject, because the bug
 * was invisible precisely at the level a unit test of the hook would not reach:
 * the hook "worked", the UI lied.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import type { CourseLesson, CourseSection } from "../lib/api-learning";

const updateSection = vi.fn(async (_id: string, _patch: unknown) => ({}));
const createSection = vi.fn(async (_productId: string, _draft: { title: string }) => ({ id: "sec-2" }));
const updateLesson = vi.fn(async (_lessonId: string, _patch: unknown) => ({}));
const getCourseContentClient = vi.fn(async (_tag: string, _productId: string) => [] as CourseSection[]);

vi.mock("../lib/api-learning-authoring", () => ({
  createSection: (...a: Parameters<typeof createSection>) => createSection(...a),
  updateSection: (...a: Parameters<typeof updateSection>) => updateSection(...a),
  updateLesson: (...a: Parameters<typeof updateLesson>) => updateLesson(...a),
  createLesson: vi.fn(async () => ({ id: "lesson-new" })),
  deleteLesson: vi.fn(),
  deleteSection: vi.fn(),
  uploadLessonMedia: vi.fn(),
  uploadCourseFile: vi.fn(),
  deleteLessonMedia: vi.fn(),
  reorderSections: vi.fn(),
  reorderLessons: vi.fn(),
  setPreviewBoundary: vi.fn(async () => ({ freeCount: 0 })),
  linkLessonVideo: vi.fn(),
}));

vi.mock("../lib/api-learning-quizzes", () => ({
  createQuiz: vi.fn(async () => ({ id: "quiz-1" })),
  getQuizAsAuthor: vi.fn(async () => ({
    id: "quiz-1", lessonId: "lesson-1", passPercent: null, maxAttempts: null,
    instructions: null, questionCount: 0, questions: [] as unknown[],
  })),
  updateQuiz: vi.fn(), deleteQuiz: vi.fn(), createQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(), reorderQuizQuestions: vi.fn(),
  updateQuizQuestion: vi.fn(), replaceQuizOptions: vi.fn(),
}));

vi.mock("../lib/api-learning", () => ({
  getCourseContentClient: (...a: Parameters<typeof getCourseContentClient>) =>
    getCourseContentClient(...a),
}));

// eslint-disable-next-line import/first
import { CourseBuilder } from "../components/CourseBuilder.client";

const FAILED_TITLE = enMessages.learning.builder.saveFailedTitle;

function section(lessons: CourseLesson[] = []): CourseSection {
  return { id: "sec-1", title: "Module one", description: null, order: 0, lessons } as CourseSection;
}

function lesson(over: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: "lesson-1", title: "Throwing a cylinder", description: null, order: 0,
    isPreview: false, locked: false, quizId: null, media: [], ...over,
  } as CourseLesson;
}

async function mount(sections: CourseSection[]) {
  getCourseContentClient.mockResolvedValue(sections);
  const r = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourseBuilder productId="prod-1" communityTag="pots" initialSections={sections} />
    </NextIntlClientProvider>,
  );
  await screen.findByDisplayValue("Module one");
  return r;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a failed write is reported, not swallowed", () => {
  it("shows the SERVER's message when renaming a module fails", async () => {
    // The server's sentence, not a generic one: it is the only specific thing
    // we know, and api-learning-authoring already throws it verbatim.
    updateSection.mockRejectedValueOnce(new Error("A module with that name already exists."));
    await mount([section()]);

    const title = screen.getByDisplayValue("Module one");
    fireEvent.change(title, { target: { value: "Module uno" } });
    fireEvent.blur(title);

    expect(await screen.findByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText("A module with that name already exists.")).toBeTruthy();
  });

  it("says nothing when the same write SUCCEEDS", async () => {
    // Guards the other direction: a notice that is always present reports
    // nothing, and would be worse than the silence it replaced.
    await mount([section()]);

    const title = screen.getByDisplayValue("Module one");
    fireEvent.change(title, { target: { value: "Module uno" } });
    fireEvent.blur(title);

    await waitFor(() => expect(updateSection).toHaveBeenCalled());
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it("clears the notice when a retry works", async () => {
    updateSection
      .mockRejectedValueOnce(new Error("Gateway timeout"))
      .mockResolvedValueOnce({});
    await mount([section()]);

    const title = screen.getByDisplayValue("Module one");
    fireEvent.change(title, { target: { value: "Module uno" } });
    fireEvent.blur(title);
    expect(await screen.findByText(FAILED_TITLE)).toBeTruthy();

    // A stale failure sitting next to a save that then worked is its own lie.
    fireEvent.change(title, { target: { value: "Module dos" } });
    fireEvent.blur(title);
    await waitFor(() => expect(screen.queryByText(FAILED_TITLE)).toBeNull());
  });

  it("reports a failed LESSON write too, not only a module one", async () => {
    updateLesson.mockRejectedValueOnce(new Error("That lesson no longer exists."));
    await mount([section([lesson()])]);

    const name = screen.getByDisplayValue("Throwing a cylinder");
    fireEvent.change(name, { target: { value: "Centring" } });
    fireEvent.blur(name);

    expect(await screen.findByText("That lesson no longer exists.")).toBeTruthy();
  });

  it("does not render [object Object] when something throws a non-Error", async () => {
    // Defensive: the message goes straight on screen, so a thrown object must
    // not become the notice body.
    updateSection.mockRejectedValueOnce({ weird: true });
    await mount([section()]);

    const title = screen.getByDisplayValue("Module one");
    fireEvent.change(title, { target: { value: "Module uno" } });
    fireEvent.blur(title);

    expect(await screen.findByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });
});
