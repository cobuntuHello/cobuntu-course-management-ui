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
function fileInput(accept: "video" | "caption") {
  const dialog = screen.getByRole("dialog");
  const inputs = Array.from(dialog.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
  if (accept === "video") return inputs.find((i) => i.accept.includes("video/mp4"))!;
  return inputs.find((i) => i.accept.includes("vtt"))!;
}

/*
 * The sheet's X, told apart from the footer's "Close" button.
 *
 * Both carry the accessible name "Close" - the X from its aria-label, the
 * footer one from its text - so a query by name alone matches two elements.
 * The X is the one with no text in it.
 */
function closeX() {
  return within(screen.getByRole("dialog"))
    .queryAllByRole("button", { name: "Close" })
    .find((b) => !b.textContent?.trim()) ?? null;
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

/* 15s, not the default 5: every case in here opens the notes step, which
   dynamically imports Quill. Three of them in one file put the last one past
   the default on a cold run. */
describe("the notes", { timeout: 15000 }, () => {
  it("open their own step and write on save", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Add notes for this lesson/ }));
    const save = await screen.findByRole("button", { name: /^Save$/ });
    fireEvent.click(save);
    await waitFor(() => expect(updateLesson).toHaveBeenCalled());
    expect(updateLesson.mock.calls[0][1]).toHaveProperty("description");
  });

  /* The X closes the WHOLE sheet, so on a sub-step it sits beside a Back
     button looking like it does the same thing and throws the step away
     instead. Desktop-only control; mobile never had it. */
  it("drop the X, leaving Back as the only way out of the step", async () => {
    const sheet = await openLesson();
    expect(closeX()).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: /Add notes for this lesson/ }));
    await screen.findByRole("button", { name: /Back/i });
    expect(closeX()).toBeNull();
  });

  it("put it back on the way out of the step", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /Add notes for this lesson/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Back/i }));
    await waitFor(() => expect(screen.getByText("Edit lesson")).toBeTruthy());
    expect(closeX()).toBeTruthy();
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

  /*
   * REPORTED: the picker opened behind the lesson sheet that raised it. The
   * backdrop dimmed, the lesson dialog stayed lit on top, and the dialog you
   * had just asked for was invisible. BottomSheet (the lesson sheet) is
   * z-[120] and ModalSheet (the picker) was z-[60].
   *
   * Asserted as a COMPARISON rather than against the literal 130, so the pair
   * can be renumbered together without this failing for no reason - what
   * matters is which of the two is on top.
   */
  it("opens in front of the lesson sheet, not behind it", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    await screen.findByRole("dialog", { name: /Replace/ });

    const layer = (el: Element | null) => {
      for (let n = el; n; n = n.parentElement) {
        const m = (n as HTMLElement).className?.toString().match(/z-\[(\d+)\]/);
        if (m) return Number(m[1]);
      }
      return 0;
    };
    const picker = screen.getByRole("dialog", { name: /Replace/ });
    const lessonSheet = screen.getAllByRole("dialog").find((d) => d !== picker)!;
    expect(layer(picker)).toBeGreaterThan(layer(lessonSheet));
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

  /*
   * REPORTED: "fiz o replace mas o video anterior continua e nao e o video que
   * adicionei". Neither route replaces anything by itself - both write a NEW
   * media row on the lesson - and the sheet and the row read
   * media.find(kind === "VIDEO"), the FIRST one, so what stayed on screen was
   * the video that had just been replaced.
   */
  it("drops the old video once the new file is stored", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = await screen.findByRole("dialog", { name: /Replace/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "new.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    await waitFor(() => expect(deleteLessonMedia).toHaveBeenCalledWith("m-1"));
  });

  /* The order is load-bearing: deleting first would lose the author's only
     copy if the upload then failed, and the upload is the slowest thing on
     the page with a bucket at the far end. */
  it("keeps the old video when the upload fails", async () => {
    uploadCourseFile.mockRejectedValueOnce(new Error("bucket said no"));
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = await screen.findByRole("dialog", { name: /Replace/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "new.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    await screen.findByText("bucket said no");
    expect(deleteLessonMedia).not.toHaveBeenCalled();
  });

  it("drops the old video when the replacement is a link", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = within(await screen.findByRole("dialog", { name: /Replace/ }));
    fireEvent.change(picker.getByLabelText("Paste a YouTube link"), {
      target: { value: "https://youtube.com/watch?v=abc" },
    });
    fireEvent.click(picker.getByRole("button", { name: /^Replace$/ }));
    await waitFor(() => expect(deleteLessonMedia).toHaveBeenCalledWith("m-1"));
  });

  /* A lesson created by dropping a file is already named from it; a lesson
     made some other way and then given a video was the case that stayed
     "Lesson title" with a video in it. */
  it("names an untitled lesson after the video it is given", async () => {
    const sheet = await openLesson(lesson({ title: "", media: [] }));
    fireEvent.click(sheet.getByRole("button", { name: /^Add video$/ }));
    const picker = await screen.findByRole("dialog", { name: /Add video/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "01-centring-final.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    await waitFor(() => expect(updateLesson).toHaveBeenCalledWith("lesson-1", { title: "Centring" }));
  });

  /* The guard. Renaming on every upload would take the author's own title
     away as a side effect of fixing their video, unrecoverably. */
  it("leaves a lesson the author has named alone", async () => {
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = await screen.findByRole("dialog", { name: /Replace/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "take-2.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    await waitFor(() => expect(uploadCourseFile).toHaveBeenCalled());
    expect(updateLesson).not.toHaveBeenCalled();
  });

  it("deletes nothing when the lesson had no video to begin with", async () => {
    const sheet = await openLesson(lesson({ media: [] }));
    fireEvent.click(sheet.getByRole("button", { name: /^Add video$/ }));
    const picker = await screen.findByRole("dialog", { name: /Add video/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "first.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    await waitFor(() => expect(uploadCourseFile).toHaveBeenCalled());
    expect(deleteLessonMedia).not.toHaveBeenCalled();
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

describe("the controls that were taken off the strip", () => {
  /*
   * Both removed deliberately, so these pin the ABSENCE - otherwise the next
   * person to touch this strip has nothing telling them the gap is a decision
   * rather than an oversight.
   */
  it("offers no separate 'Link a video': Replace already asks that", async () => {
    const sheet = await openLesson();
    expect(sheet.queryByRole("button", { name: /Link a video/ })).toBeNull();
  });

  /* KNOWN CONSEQUENCE: nothing in the builder adds an attachment any more.
     Existing ones still list and can still be deleted. */
  it("offers no 'Add a file'", async () => {
    const sheet = await openLesson();
    expect(sheet.queryByRole("button", { name: /Add a file/ })).toBeNull();
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

describe("when an upload fails", () => {
  /*
   * Surfaced, unlike every other failure on this page. An upload is the one
   * action here where the author has spent real time before the failure, and
   * silently dropping a large file reads as the page ignoring them.
   */
  it("says so instead of failing quietly", async () => {
    uploadCourseFile.mockRejectedValueOnce(new Error("Bucket refused the file"));
    const sheet = await openLesson();
    fireEvent.click(sheet.getByRole("button", { name: /^Replace$/ }));
    const picker = await screen.findByRole("dialog", { name: /Replace/ });
    const zone = within(picker).getByText("Upload a video file").closest("div") as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "new.mp4", { type: "video/mp4" })], items: [], types: ["Files"] },
    });
    expect(await screen.findByText("Bucket refused the file")).toBeTruthy();
  });

  it("clears the caption input so the same file can be retried", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("en");
    uploadLessonMedia.mockRejectedValueOnce(new Error("nope"));
    await openLesson();
    const input = fileInput("caption");
    fireEvent.change(input, { target: { files: [new File(["x"], "subs.vtt", { type: "text/vtt" })] } });
    await waitFor(() => expect(uploadLessonMedia).toHaveBeenCalled());
    /* Without the clear, choosing the SAME file again fires no change event
       and the retry after a failure is impossible. */
    expect(input.value).toBe("");
  });
});
