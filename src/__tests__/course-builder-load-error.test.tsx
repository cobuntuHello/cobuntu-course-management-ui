/*
 * The syllabus read fails on mount — two different messages, one real cause
 * each.
 *
 * A 404 here means something specific and nameable: the community cannot read
 * this course's syllabus at all (most often, Learning is not rolled out there
 * yet). Lumping it in with "the request failed, try again" left an admin
 * staring at a vague error for what is actually an ordinary case — opening
 * /learning/new for a community nobody has onboarded onto Learning yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import { ApiError } from "../lib/api";

const getCourseContentClient = vi.fn();

vi.mock("../lib/api-learning-authoring", () => ({
  createSection: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  deleteLesson: vi.fn(),
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

vi.mock("../lib/api-learning-quizzes", () => ({
  createQuiz: vi.fn(),
  getQuizAsAuthor: vi.fn(),
  updateQuiz: vi.fn(),
  deleteQuiz: vi.fn(),
  createQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(),
  reorderQuizQuestions: vi.fn(),
  updateQuizQuestion: vi.fn(),
  replaceQuizOptions: vi.fn(),
}));

vi.mock("../lib/api-learning", () => ({
  getCourseContentClient: (...a: unknown[]) => getCourseContentClient(...a),
}));

// eslint-disable-next-line import/first
import { CourseBuilder } from "../components/CourseBuilder.client";

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourseBuilder productId="prod-1" communityTag="pbn" initialSections={[]} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the syllabus read fails with a 404", () => {
  it("says Learning is not available here, not a generic load failure", async () => {
    getCourseContentClient.mockRejectedValue(new ApiError(404, "Not found"));
    mount();

    expect(await screen.findByText("Courses aren't available for this community yet.")).toBeTruthy();
    expect(screen.queryByText("We could not load this course's outline. Refresh the page to try again.")).toBeNull();
  });
});

describe("the syllabus read fails some other way", () => {
  it("keeps the generic load-failed message for a 500", async () => {
    getCourseContentClient.mockRejectedValue(new ApiError(500, "Something went wrong"));
    mount();

    expect(await screen.findByText("We could not load this course's outline. Refresh the page to try again.")).toBeTruthy();
    expect(screen.queryByText("Courses aren't available for this community yet.")).toBeNull();
  });

  it("keeps the generic load-failed message for a plain network error", async () => {
    getCourseContentClient.mockRejectedValue(new TypeError("Failed to fetch"));
    mount();

    expect(await screen.findByText("We could not load this course's outline. Refresh the page to try again.")).toBeTruthy();
  });
});
