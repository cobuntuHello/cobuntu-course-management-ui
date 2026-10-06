import { apiClient } from "./api";

export interface CourseLessonMedia {
  id: string;
  /*
   * WHERE this video lives. The player picks a source adapter from it before
   * asking for anything; the provider's id itself is NOT here, and arrives
   * only from the entitlement-checked playback endpoint.
   *
   * Optional because older payloads predate it, and absent means UPLOAD -
   * which is what every lesson was before linking existed.
   */
  provider?: "UPLOAD" | "YOUTUBE";
  /*
   * Which lesson this belongs to.
   *
   * Absent from the syllabus payload, where the media already sits INSIDE its
   * lesson and repeating the id would be noise. It is present on the response
   * to a direct upload, which is the one case where the caller does not know
   * the lesson yet: a drop onto a module has the server create the lesson, so
   * this is how the builder learns which row to focus.
   */
  lessonId?: string;
  kind: "VIDEO" | "ATTACHMENT" | "CAPTION";
  originalName: string;
  mimeType: string;
  fileSize: number;
  durationSeconds: number | null;
  order: number;
  /**
   * BCP-47 tag on a CAPTION row, null on everything else.
   *
   * `<track>` needs it twice over: as `srclang`, so a browser knows what it is
   * reading, and to name the track in the captions menu. A course with two
   * caption files and no languages is two identical menu entries.
   */
  language: string | null;
}

export interface CourseLesson {
  id: string;
  title: string;
  description: string | null;
  order: number;
  isPreview: boolean;
  /** True when this viewer cannot play or download this lesson's files. */
  locked: boolean;
  /**
   * The quiz on this lesson, or null. A lesson with one IS a quiz lesson.
   *
   * Sent to non-buyers too, deliberately: "this chapter ends with a quiz" is
   * part of what sells a course. The id opens nothing on its own, because the
   * quiz endpoint answers 404 to anyone who has not bought it.
   */
  quizId: string | null;
  /**
   * The same quiz, described: its shape, and how THIS viewer has done at it.
   *
   * Beside `quizId` rather than replacing it, which is how the backend sends it
   * -- every existing caller reads the id, and a field two deploys both
   * understand beats a coordinated cutover. Optional here for the same reason:
   * a client on this version talking to a core that predates the field gets
   * `undefined`, and every reader below treats that as "nothing to say".
   *
   * The QUESTIONS are not here and never will be. Shipping every prompt to
   * every reader of a syllabus hands away the paper; they stay behind
   * `getQuiz`, which 404s for anyone who has not bought the course.
   */
  quiz?: CourseLessonQuiz | null;
  media: CourseLessonMedia[];
}

/**
 * A quiz as the SYLLABUS describes it.
 *
 * `questionCount` and `passPercent` come to everyone, on the same rule that
 * sends a locked lesson's runtime: "three questions, 70% to pass" is part of
 * what sells the course. `attempt` is the viewer's own and nobody else's.
 */
export interface CourseLessonQuiz {
  id: string;
  questionCount: number;
  /**
   * NULL means UNGATED, and must be read as a distinct state rather than as
   * zero: a gated quiz at 0 would mean "you need nothing to pass".
   */
  passPercent: number | null;
  maxAttempts: number | null;
  /** This viewer's standing, or null when they have not sat it. */
  attempt: {
    count: number;
    /**
     * Their BEST score, not their latest. Somebody who passed and then retried
     * for fun has still passed; the PLAYER shows the latest, because there the
     * question is "how did that go" rather than "where do I stand".
     */
    bestScorePercent: number;
    passed: boolean;
  } | null;
}

export interface CourseSection {
  id: string;
  title: string;
  description: string | null;
  order: number;
  lessons: CourseLesson[];
}

export function getCourseContentClient(
  tag: string,
  productId: string,
): Promise<CourseSection[]> {
  return apiClient<CourseSection[]>(
    `/api/communities/${encodeURIComponent(tag)}/courses/${encodeURIComponent(productId)}/content`,
  );
}
