/*
 * The Edit lesson sheet, path by path.
 *
 * Everything an author can do to one lesson lives in this dialog, and almost
 * none of it was covered: the only render suite that touched the builder is
 * skipped in full. These walk each control and assert on the WRITE it makes,
 * not on the markup around it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import type { CourseLesson, CourseSection } from "../lib/api-learning";

const updateLesson = vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({}));
const deleteLesson = vi.fn(async (_id: string) => undefined);
const deleteLessonMedia = vi.fn(async (_id: string) => undefined);
const uploadCourseFile = vi.fn(async (_t: unknown, file: File, o?: { kind?: string }) => ({
  id: "m-new", lessonId: "lesson-1", originalName: file.name,
  durationSeconds: 30, kind: o?.kind ?? "ATTACHMENT",
}));
const uploadLessonMedia = vi.fn(async (_id: string, _f: File, _o?: { language?: string }) => ({}));
const linkLessonVideo = vi.fn(async (_id: string, _b: unknown) => ({}));
const setPreviewBoundary = vi.fn(async (_p: string, _l: string | null) => ({ freeCount: 1 }));
const getCourseContentClient = vi.fn(async () => [] as CourseSection[]);

vi.mock("../lib/api-learning-authoring", () => ({
  createSection: vi.fn(), createLesson: vi.fn(), updateSection: vi.fn(), deleteSection: vi.fn(),
  reorderSections: vi.fn(), reorderLessons: vi.fn(),
  updateLesson: (...a: Parameters<typeof updateLesson>) => updateLesson(...a),
  deleteLesson: (...a: Parameters<typeof deleteLesson>) => deleteLesson(...a),
  deleteLessonMedia: (...a: Parameters<typeof deleteLessonMedia>) => deleteLessonMedia(...a),
  uploadCourseFile: (...a: Parameters<typeof uploadCourseFile>) => uploadCourseFile(...a),
  uploadLessonMedia: (...a: Parameters<typeof uploadLessonMedia>) => uploadLessonMedia(...a),
  linkLessonVideo: (...a: Parameters<typeof linkLessonVideo>) => linkLessonVideo(...a),
  setPreviewBoundary: (...a: Parameters<typeof setPreviewBoundary>) => setPreviewBoundary(...a),
}));
vi.mock("../lib/api-learning-quizzes", () => ({
  createQuiz: vi.fn(), getQuizAsAuthor: vi.fn(async () => ({ questions: [] })), updateQuiz: vi.fn(),
  deleteQuiz: vi.fn(), createQuizQuestion: vi.fn(), deleteQuizQuestion: vi.fn(),
  reorderQuizQuestions: vi.fn(), updateQuizQuestion: vi.fn(), replaceQuizOptions: vi.fn(),
}));
vi.mock("../lib/api-learning", () => ({
  getCourseContentClient: (...a: unknown[]) => getCourseContentClient(...(a as [])),
}));

// eslint-disable-next-line import/first
import { CourseBuilder } from "../components/CourseBuilder.client";

const VIDEO = {
  id: "m-1", kind: "VIDEO" as const, originalName: "wheel.mp4", mimeType: "video/mp4",
  fileSize: 2048, durationSeconds: 10, order: 0, language: null,
};

function lesson(over: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: "lesson-1", title: "Throwing a cylinder", description: null, order: 0,
    isPreview: false, locked: false, quizId: null, media: [VIDEO], ...over,
  } as CourseLesson;
}
function section(lessons: CourseLesson[]): CourseSection {
  return { id: "sec-1", title: "Module one", description: null, order: 0, lessons } as CourseSection;
}

/** Mount, then open the one lesson's dialog. */
async function openLesson(l: CourseLesson = lesson()) {
  const sections = [section([l])];
  getCourseContentClient.mockResolvedValue(sections);
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourseBuilder productId="prod-1" communityTag="pots" initialSections={sections as never} />
    </NextIntlClientProvider>,
  );
  await screen.findByDisplayValue("Module one");
  fireEvent.click(screen.getByRole("button", { name: l.quizId ? "Edit quiz" : "Edit lesson" }));
  return within(await screen.findByRole("dialog"));
}

/*
 * The sheet's own hidden file inputs.
 *
 * Scoped to the dialog on purpose. The module footer's "Add a video lesson"
 * card has an input with the SAME accept list, earlier in the document, and a
 * bare document.querySelector finds that one - which creates a NEW lesson from
 * the file instead of replacing this one's video, so the assertion fails
 * describing a feature that works.
 */
function fileInput(accept: "video" | "caption" | "any") {
  const dialog = screen.getByRole("dialog");
  const inputs = Array.from(dialog.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
  if (accept === "video") return inputs.find((i) => i.accept.includes("video/mp4"))!;
  if (accept === "caption") return inputs.find((i) => i.accept.includes("vtt"))!;
  return inputs.find((i) => !i.accept)!;
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("opening it", () => {
  it("is headed as an edit and carries the lesson's name", async () => {
    const sheet = await openLesson();
    expect(sheet.getByText("Edit lesson")).toBeTruthy();
    expect(sheet.getByDisplayValue("Throwing a cylinder")).toBeTruthy();
  });

  it("shows the video it has, with its length", async () => {
    const sheet = await openLesson();
    expect(sheet.getByText("wheel.mp4")).toBeTruthy();
    expect(sheet.getByText("10 s")).toBeTruthy();
  });
});

describe("the name", () => {
  it("is written on blur", async () => {
    const sheet = await openLesson();
    const field = sheet.getByDisplayValue("Throwing a cylinder");
    fireEvent.change(field, { target: { value: "Centring the clay" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateLesson).toHaveBeenCalledWith("lesson-1", { title: "Centring the clay" }));
  });
});

describe("the notes", () => {
  it("open their own step and write on save", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Add notes for this lesson/ }));
    const save = await screen.findByRole("button", { name: /^Save$/ });
    fireEvent.click(save);
    await waitFor(() => expect(updateLesson).toHaveBeenCalled());
    expect(updateLesson.mock.calls[0][1]).toHaveProperty("description");
  });

  it("write nothing when the step is backed out of", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Add notes for this lesson/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Back/i }));
    await waitFor(() => expect(screen.getByText("Edit lesson")).toBeTruthy());
    expect(updateLesson).not.toHaveBeenCalled();
  });
});

describe("the video", () => {
  it("is removed by its bin", async () => {
    const sheet = await openLesson();
    const row = sheet.getByText("wheel.mp4").closest("div") as HTMLElement;
    const bin = within(row.parentElement as HTMLElement).getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.match(/remove|delete/i));
    fireEvent.click(bin ?? within(row.parentElement as HTMLElement).getAllByRole("button").slice(-1)[0]);
    await waitFor(() => expect(deleteLessonMedia).toHaveBeenCalledWith("m-1"));
  });

  /*
   * Replace opens a DIALOG now, not the operating system's file picker, and
   * that dialog asks the whole question: a file, or a link. It used to go
   * straight to the picker, so the prominent button silently answered "a
   * file" and the link half was a small text button further down the sheet.
   */
  it("asks where the new video comes from, rather than going straight to the picker", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = within(await screen.findByRole("dialog", { name: /Replace/ }));
    expect(picker.getByText("Upload a video file")).toBeTruthy();
    expect(picker.getByLabelText("Paste a YouTube link")).toBeTruthy();
    /* Not the add-a-lesson copy: nothing here is adding a lesson. Scoped to
       the picker, because the MODULE's own "Add a video lesson" card is on
       the page behind it and a bare query finds that instead. */
    expect(picker.queryByText("Add a video lesson")).toBeNull();
    expect(picker.queryByRole("button", { name: "Add this lesson" })).toBeNull();
  });

  it("uploads a dropped file as a VIDEO", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = await screen.findByRole("dialog", { name: /Replace/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    const file = new File(["x"], "new.mp4", { type: "video/mp4" });
    fireEvent.drop(zone, { dataTransfer: { files: [file], items: [], types: ["Files"] } });
    await waitFor(() => expect(uploadCourseFile).toHaveBeenCalled());
    expect(uploadCourseFile.mock.calls[0][0]).toMatchObject({ lessonId: "lesson-1" });
    expect(uploadCourseFile.mock.calls[0][2]).toMatchObject({ kind: "VIDEO" });
  });

  it("links a URL to THIS lesson instead of making a new one", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = within(await screen.findByRole("dialog", { name: /Replace/ }));
    fireEvent.change(picker.getByLabelText("Paste a YouTube link"), {
      target: { value: "https://youtube.com/watch?v=abc" },
    });
    fireEvent.click(picker.getByRole("button", { name: /^Replace$/ }));
    await waitFor(() => expect(linkLessonVideo).toHaveBeenCalled());
    expect(linkLessonVideo.mock.calls[0][0]).toMatchObject({ lessonId: "lesson-1" });
  });

  it("is headed 'Add video' on a lesson that has none yet", async () => {
    const sheet = await openLesson(lesson({ media: [] }));
    fireEvent.click(sheet.getByRole("button", { name: /^Add video$/ }));
    expect(await screen.findByRole("dialog", { name: /Add video/ })).toBeTruthy();
  });

});

describe("adding a file", () => {
  it("uploads it as an ATTACHMENT, whatever its type", async () => {
    await openLesson();
    fireEvent.change(fileInput("any"), { target: { files: [new File(["x"], "kit.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(uploadCourseFile).toHaveBeenCalled());
    expect(uploadCourseFile.mock.calls[0][2]).toMatchObject({ kind: "ATTACHMENT" });
  });
});

describe("adding captions", () => {
  it("asks for the language and sends it", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("pt");
    await openLesson();
    fireEvent.change(fileInput("caption"), { target: { files: [new File(["x"], "subs.vtt", { type: "text/vtt" })] } });
    await waitFor(() => expect(uploadLessonMedia).toHaveBeenCalled());
    expect(uploadLessonMedia.mock.calls[0][2]).toMatchObject({ language: "pt" });
  });

  it("uploads nothing when the language prompt is dismissed", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await openLesson();
    fireEvent.change(fileInput("caption"), { target: { files: [new File(["x"], "subs.vtt", { type: "text/vtt" })] } });
    await new Promise((r) => setTimeout(r, 30));
    expect(uploadLessonMedia).not.toHaveBeenCalled();
  });
});

describe("removing the lesson", () => {
  it("asks first, naming the lesson", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Remove lesson/ }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText(/Throwing a cylinder/)).toBeTruthy();
    expect(deleteLesson).not.toHaveBeenCalled();
  });

  it("deletes on confirm", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Remove lesson/ }));
    const confirm = within(await screen.findByRole("dialog"));
    fireEvent.click(confirm.getAllByRole("button", { name: /Remove lesson/ }).slice(-1)[0]);
    await waitFor(() => expect(deleteLesson).toHaveBeenCalledWith("lesson-1"));
  });

  it("puts the sheet back when the question is declined", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Remove lesson/ }));
    const confirm = within(await screen.findByRole("dialog"));
    fireEvent.click(confirm.getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(screen.getByText("Edit lesson")).toBeTruthy());
    expect(deleteLesson).not.toHaveBeenCalled();
  });
});

describe("linking a video the author already has online", () => {
  it("opens its own dialog from the lesson's strip", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Link a video/ }));
    /* A second sheet, over the lesson's, with somewhere to paste a URL. */
    await waitFor(() => {
      const urlField = document.querySelector('input[type="url"], input[placeholder*="http" i]');
      expect(urlField).toBeTruthy();
    });
  });
});

describe("when an upload fails", () => {
  /*
   * Surfaced, unlike every other failure on this page. An upload is the one
   * action here where the author has spent real time before the failure, and
   * silently dropping a large file reads as the page ignoring them.
   */
  it("says so instead of failing quietly", async () => {
    uploadCourseFile.mockRejectedValueOnce(new Error("Bucket refused the file"));
    await openLesson();
    fireEvent.change(fileInput("any"), {
      target: { files: [new File(["x"], "kit.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByText("Bucket refused the file")).toBeTruthy();
  });

  it("lets the same file be chosen again for a retry", async () => {
    uploadCourseFile.mockRejectedValueOnce(new Error("nope"));
    await openLesson();
    const input = fileInput("any");
    const file = new File(["x"], "kit.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("nope");
    /* The input clears itself after each pick; without that, choosing the
       SAME file again fires no change event and the retry is impossible. */
    expect(input.value).toBe("");
  });
});
