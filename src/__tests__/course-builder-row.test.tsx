/*
 * The lesson row: its NAME, its LENGTH, and how a quiz gets made.
 *
 * Why a new file rather than three cases in course-builder-drop: that suite is
 * skipped in full, pending a re-anchor of queries written against copy the
 * builder stopped using in October. Adding to it would mean adding tests that
 * do not run. These are the three behaviours changed here and nothing else, so
 * they are anchored to current copy and they are green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import type { CourseLesson, CourseSection } from "../lib/api-learning";

const createSection = vi.fn(async (_productId: string, _draft: { title: string }) => ({ id: "sec-1" }));
const createLesson = vi.fn(async (_sectionId: string, _draft: { title: string }) => ({ id: "lesson-new" }));
const updateLesson = vi.fn(async (_lessonId: string, _patch: { title?: string }) => ({}));
const deleteLesson = vi.fn(async (_lessonId: string) => undefined);
const getCourseContentClient = vi.fn(async (_tag: string, _productId: string) => [] as CourseSection[]);

vi.mock("../lib/api-learning-authoring", () => ({
  createSection: (...a: Parameters<typeof createSection>) => createSection(...a),
  createLesson: (...a: Parameters<typeof createLesson>) => createLesson(...a),
  updateLesson: (...a: Parameters<typeof updateLesson>) => updateLesson(...a),
  deleteLesson: (...a: Parameters<typeof deleteLesson>) => deleteLesson(...a),
  uploadLessonMedia: vi.fn(),
  uploadCourseFile: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  deleteLessonMedia: vi.fn(),
  reorderSections: vi.fn(),
  reorderLessons: vi.fn(),
  setPreviewBoundary: vi.fn(),
  linkLessonVideo: vi.fn(),
}));

/* Left real, these reach the suite's un-mocked `fetch` and the rejection
   surfaces as an unhandled error rather than a failing assertion. */
const createQuiz = vi.fn(async (_lessonId: string, _draft: unknown) => ({ id: "quiz-1" }));
const getQuizAsAuthor = vi.fn(async () => ({
  id: "quiz-1", lessonId: "lesson-new", passPercent: null, maxAttempts: null,
  instructions: null, questionCount: 0, questions: [] as unknown[],
}));
vi.mock("../lib/api-learning-quizzes", () => ({
  createQuiz: (...a: Parameters<typeof createQuiz>) => createQuiz(...a),
  getQuizAsAuthor: (...a: unknown[]) => getQuizAsAuthor(...(a as [])),
  updateQuiz: vi.fn(),
  deleteQuiz: vi.fn(),
  createQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(),
  reorderQuizQuestions: vi.fn(),
  updateQuizQuestion: vi.fn(),
  replaceQuizOptions: vi.fn(),
}));

vi.mock("../lib/api-learning", () => ({
  getCourseContentClient: (...a: Parameters<typeof getCourseContentClient>) =>
    getCourseContentClient(...a),
}));

// eslint-disable-next-line import/first
import { CourseBuilder } from "../components/CourseBuilder.client";

function lesson(over: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: "lesson-1", title: "Throwing a cylinder", description: null, order: 0,
    isPreview: false, locked: false, quizId: null, media: [], ...over,
  } as CourseLesson;
}

function video(durationSeconds: number | null) {
  return {
    id: "m-1", kind: "VIDEO" as const, originalName: "wheel.mp4", mimeType: "video/mp4",
    fileSize: 1024, durationSeconds, order: 0, language: null,
  };
}

function section(lessons: CourseLesson[]): CourseSection {
  return { id: "sec-1", title: "Module one", description: null, order: 0, lessons } as CourseSection;
}

async function mount(sections: CourseSection[]) {
  getCourseContentClient.mockResolvedValue(sections);
  const rendered = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourseBuilder productId="prod-1" communityTag="pots" initialSections={sections} />
    </NextIntlClientProvider>,
  );
  // The module's own title field is the first thing a loaded outline shows.
  await screen.findByDisplayValue("Module one");
  return rendered;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a lesson's name is editable on the row", () => {
  it("renders the title as a field, not as text", async () => {
    await mount([section([lesson()])]);
    expect(screen.getByDisplayValue("Throwing a cylinder")).toBeTruthy();
  });

  it("writes the new name on blur", async () => {
    await mount([section([lesson()])]);
    const field = screen.getByDisplayValue("Throwing a cylinder");
    fireEvent.change(field, { target: { value: "Centring the clay" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateLesson).toHaveBeenCalledWith("lesson-1", { title: "Centring the clay" }));
  });

  it("does the same for a quiz, whose name is the lesson's", async () => {
    await mount([section([lesson({ id: "lesson-q", title: "End of module check", quizId: "quiz-1" })])]);
    const field = screen.getByDisplayValue("End of module check");
    fireEvent.change(field, { target: { value: "Module one quiz" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateLesson).toHaveBeenCalledWith("lesson-q", { title: "Module one quiz" }));
  });

  it("writes nothing when the name did not change", async () => {
    await mount([section([lesson()])]);
    fireEvent.blur(screen.getByDisplayValue("Throwing a cylinder"));
    expect(updateLesson).not.toHaveBeenCalled();
  });

  /* The name has TWO fields now - the row's and the dialog's - so a commit in
     one has to reach the other. The draft used to be seeded once and never
     again, which was harmless while there was only one field. */
  it("follows a rename made in the dialog", async () => {
    const withNewTitle = [section([lesson({ title: "Centring the clay" })])];
    await mount([section([lesson()])]);

    fireEvent.click(screen.getByRole("button", { name: "Edit lesson" }));
    const inSheet = within(await screen.findByRole("dialog"))
      .getByDisplayValue("Throwing a cylinder");

    getCourseContentClient.mockResolvedValue(withNewTitle);
    fireEvent.change(inSheet, { target: { value: "Centring the clay" } });
    fireEvent.blur(inSheet);

    await waitFor(() => expect(screen.getAllByDisplayValue("Centring the clay").length).toBeGreaterThan(1));
  });

  /*
   * The focus guard on that sync.
   *
   * It bites when the stored title changes WHILE the field is focused with an
   * uncommitted draft - a server that trims or normalises what it was sent, or
   * a commit from the lesson dialog's copy of the same field. Without the
   * guard the draft is replaced mid-sentence.
   */
  it("does not wipe what is being typed when the stored title changes", async () => {
    await mount([section([
      lesson({ id: "lesson-1", title: "Throwing a cylinder" }),
      lesson({ id: "lesson-2", title: "Trimming a foot", order: 1 }),
    ])]);

    const mine = screen.getByDisplayValue("Throwing a cylinder") as HTMLInputElement;
    mine.focus();
    fireEvent.change(mine, { target: { value: "Centring the cl" } });

    /* The next read comes back with MY row's title changed too, as a server
       that normalised it would. The refresh is triggered by the sibling. */
    getCourseContentClient.mockResolvedValue([section([
      lesson({ id: "lesson-1", title: "Throwing A Cylinder" }),
      lesson({ id: "lesson-2", title: "Trimming the foot", order: 1 }),
    ])]);
    const reads = getCourseContentClient.mock.calls.length;
    const other = screen.getByDisplayValue("Trimming a foot");
    fireEvent.change(other, { target: { value: "Trimming the foot" } });
    fireEvent.blur(other);
    /*
     * Waited on the RE-READ, not on the sibling's text. That field already
     * holds "Trimming the foot" as its own uncommitted draft, so a query for
     * it resolves on the first tick - before the refresh has landed - and the
     * assertion below then runs against a tree the new titles never reached.
     */
    await waitFor(() => expect(getCourseContentClient.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.getByDisplayValue("Centring the cl")).toBeTruthy());

    expect(mine.value).toBe("Centring the cl");
  });

  /* The row carries ONE pill now. Four shrink-0 pills next to a flex-1 input
     meant the pills took every pixel and the field collapsed to a stub. */
  it("carries the duration and nothing else", async () => {
    await mount([section([lesson({
      media: [
        video(20),
        { id: "a-1", kind: "ATTACHMENT" as const, originalName: "kit.pdf", mimeType: "application/pdf", fileSize: 10, durationSeconds: null, order: 1, language: null },
      ],
    })])]);
    const r = screen.getByDisplayValue("Throwing a cylinder").closest("li") as HTMLElement;
    expect(within(r).getByText("20 s")).toBeTruthy();
    expect(within(r).queryByText("No captions")).toBeNull();
    expect(within(r).queryByText("Locked until they buy")).toBeNull();
    expect(within(r).queryByText(/attachment/i)).toBeNull();
  });

  /* The row stops at the chevron. Every shrink-0 control kept here is width
     taken from the title field, which is the only thing on it that flexes. */
  it("carries no delete and no preview-boundary control", async () => {
    await mount([section([lesson({ media: [video(20)] })])]);
    const r = screen.getByDisplayValue("Throwing a cylinder").closest("li") as HTMLElement;
    expect(within(r).queryByRole("button", { name: "Remove lesson" })).toBeNull();
    expect(within(r).queryByRole("button", { name: /free preview/i })).toBeNull();
  });

  /* Deleting did not go away - it went back to the dialog's footer. */
  it("still deletes, from inside the dialog", async () => {
    await mount([section([lesson()])]);
    fireEvent.click(screen.getByRole("button", { name: "Edit lesson" }));
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByRole("button", { name: "Remove lesson" })).toBeTruthy();
  });

  it("still offers a way to open the lesson", async () => {
    await mount([section([lesson()])]);
    expect(screen.getByRole("button", { name: "Edit lesson" })).toBeTruthy();
  });
});

describe("how long a lesson is", () => {
  /*
   * Scoped to the ROW, not to the page. The builder also prints the whole
   * course's runtime in its summary, so a bare getByText("3 min") matches
   * two nodes and queryByText("0 min") matches the summary of a course with
   * nothing in it - both of which pass or fail for reasons that have nothing
   * to do with the pill being tested.
   */
  function row() {
    return screen.getByDisplayValue("Throwing a cylinder").closest("li") as HTMLElement;
  }

  /* The regression: Math.round(20 / 60) is 0, so a 20-second clip announced
     itself as "0 min" the moment its upload finished. */
  it("is written in seconds under a minute", async () => {
    await mount([section([lesson({ media: [video(20)] })])]);
    expect(within(row()).getByText("20 s")).toBeTruthy();
    expect(within(row()).queryByText("0 min")).toBeNull();
  });

  it("is still written in minutes at a minute and over", async () => {
    await mount([section([lesson({ media: [video(180)] })])]);
    expect(within(row()).getByText("3 min")).toBeTruthy();
  });

  it("rounds to the nearest second rather than away", async () => {
    await mount([section([lesson({ media: [video(1)] })])]);
    expect(within(row()).getByText("1 s")).toBeTruthy();
  });

  /* A stored 0 means "not known", not "zero seconds long". */
  it("says the video is missing rather than printing a zero", async () => {
    await mount([section([lesson({ media: [video(0)] })])]);
    expect(within(row()).queryByText("0 s")).toBeNull();
    expect(within(row()).queryByText("0 min")).toBeNull();
  });
});

describe("adding a quiz", () => {
  /**
   * Press "Add a quiz" with a server that returns the row afterwards.
   *
   * `addQuiz` creates the lesson, creates its quiz, re-reads the course and
   * THEN marks the new id - the sheet it opens belongs to the row that read
   * brings back. A fake server that keeps answering with an empty module
   * leaves nothing to open, which is a fixture that does not match the
   * contract rather than a bug.
   */
  /*
   * The SHEET, because the row behind it has a delete of its own whose label
   * is also "Remove quiz" - an unscoped query matches both and the assertion
   * is then about the row, not about the footer being tested.
   */
  function sheet() {
    return within(screen.getByRole("dialog"));
  }

  async function addQuiz() {
    await mount([section([])]);
    getCourseContentClient.mockResolvedValue([
      section([lesson({ id: "lesson-new", title: "New quiz", quizId: "quiz-1" })]),
    ]);
    fireEvent.click(screen.getByText("Add a quiz"));
  }

  it("creates it, then opens it, and offers Save", async () => {
    await addQuiz();

    await waitFor(() => expect(createQuiz).toHaveBeenCalledWith("lesson-new", {}));
    expect(createLesson).toHaveBeenCalledWith("sec-1", { title: "New quiz" });

    /* The sheet opens by itself: creating a quiz and writing one were two
       separate discoveries before this. */
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(sheet().getByRole("button", { name: "Cancel" })).toBeTruthy();
    /* Not the ordinary footer, which would offer no way to undo the create. */
    expect(sheet().queryByRole("button", { name: "Remove quiz" })).toBeNull();
  });

  it("Cancel takes the quiz back out of the course", async () => {
    await addQuiz();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(deleteLesson).toHaveBeenCalledWith("lesson-new"));
  });

  it("the X takes it back out too - only Save adds it", async () => {
    await addQuiz();
    await screen.findByRole("dialog");
    /* The sheet's own close control, not the footer's Cancel. */
    fireEvent.click(sheet().getByRole("button", { name: "Close" }));
    await waitFor(() => expect(deleteLesson).toHaveBeenCalledWith("lesson-new"));
  });

  it("Save keeps it, and the footer goes back to the ordinary one", async () => {
    await addQuiz();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(deleteLesson).not.toHaveBeenCalled();
  });

  it("an existing quiz keeps Close and Remove", async () => {
    await mount([section([lesson({ id: "lesson-q", title: "Module check", quizId: "quiz-1" })])]);
    fireEvent.click(screen.getByRole("button", { name: "Edit quiz" }));
    await screen.findByRole("dialog");
    expect(sheet().getByRole("button", { name: "Remove quiz" })).toBeTruthy();
    expect(sheet().queryByRole("button", { name: "Save" })).toBeNull();
  });
});
