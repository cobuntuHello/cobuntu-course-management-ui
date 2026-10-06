import { apiClient } from "./api";

/**
 * Quizzes: authoring them and taking them.
 *
 * ── Two shapes for one quiz, and the difference is the point ───────────────
 *
 * The server strips the answer key for anyone who is not the author, so a
 * learner's `QuizOption` genuinely has no `isCorrect` field rather than having
 * it set to false. That is modelled here as two types instead of one optional
 * property, because an optional boolean invites `if (option.isCorrect)` in code
 * that runs for learners, which would silently read undefined and mark
 * everything wrong.
 *
 * The same applies to `feedback`: an explanation usually names the right
 * answer, so it is absent until the learner has answered.
 *
 * ── Marking happens on the server ──────────────────────────────────────────
 *
 * Nothing here scores anything. The client is never sent the key, so it could
 * not, and `submitQuizAttempt` returns the marked paper: which option was
 * right, what was chosen, and why.
 */

/** An option as a LEARNER sees it, before answering. */
export interface QuizOption {
  id: string;
  label: string;
  order: number;
}

/** An option as its AUTHOR sees it. */
export interface QuizOptionAuthored extends QuizOption {
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  order: number;
  /** Author-only before answering; present on every marked result. */
  feedback?: string | null;
  options: QuizOption[];
}

export interface QuizQuestionAuthored extends QuizQuestion {
  feedback: string | null;
  options: QuizOptionAuthored[];
}

export interface QuizAttemptSummary {
  id: string;
  scorePercent: number;
  passed: boolean;
  createdAt: string;
}

export interface Quiz {
  id: string;
  lessonId: string;
  instructions: string | null;
  /**
   * NULL means UNGATED, and the UI must treat it as a distinct state rather
   * than as zero. An ungated quiz shows a score and no verdict; a gated one at
   * 0 would mean "you need nothing to pass", which is not a thing.
   */
  passPercent: number | null;
  maxAttempts: number | null;
  questionCount: number;
  questions: QuizQuestion[];
  /** This learner's attempts, newest first. Empty for the author. */
  attempts?: QuizAttemptSummary[];
}

export interface QuizAuthored extends Quiz {
  questions: QuizQuestionAuthored[];
}

/** The marked paper that comes back from an attempt. */
export interface QuizResult {
  attemptId: string;
  scorePercent: number;
  passed: boolean;
  correct: number;
  total: number;
  /** Null when the quiz is ungated: there was no bar to clear. */
  passPercent: number | null;
  questions: {
    id: string;
    prompt: string;
    feedback: string | null;
    chosenOptionId: string | null;
    options: { id: string; label: string; isCorrect: boolean }[];
  }[];
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

/**
 * Fetch a quiz.
 *
 * Answers 404 to anyone who has not bought the course, including for a lesson
 * marked as a free preview: a quiz is never a preview, because somebody who has
 * not watched the lessons it tests will fail it.
 */
export function getQuiz(quizId: string) {
  return apiClient<Quiz>(`/api/courses/quizzes/${encodeURIComponent(quizId)}`);
}

/** The same quiz, with the answer key, for its author. */
export function getQuizAsAuthor(quizId: string) {
  return apiClient<QuizAuthored>(`/api/courses/quizzes/${encodeURIComponent(quizId)}`);
}

/* ── Taking it ───────────────────────────────────────────────────────────── */

/**
 * Answer a quiz.
 *
 * `answers` maps questionId to the chosen optionId. A question left out counts
 * as WRONG rather than skipped: scoring out of questions attempted would let
 * someone answer the one they knew and score 100%.
 */
export function submitQuizAttempt(quizId: string, answers: Record<string, string>) {
  return apiClient<QuizResult>(`/api/courses/quizzes/${encodeURIComponent(quizId)}/attempts`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

/** What one answer was worth, without recording anything. */
export interface QuizCheck {
  questionId: string;
  correct: boolean;
  /** Always present, right or wrong: naming only the wrong one teaches nothing. */
  correctOptionId: string | null;
  feedback: string | null;
}

/**
 * Mark ONE answer, so the explanation lands next to the mistake.
 *
 * Records nothing: no attempt, no score, no progress. `submitQuizAttempt` stays
 * the only thing that writes, which is why a learner can check a question,
 * wander off, and come back without having "taken" the quiz.
 *
 * `optionId: null` is a skip, which counts as wrong - the same rule the scored
 * attempt applies, so the two never disagree about what a skip is worth.
 */
export function checkQuizAnswer(questionId: string, optionId: string | null) {
  return apiClient<QuizCheck>(
    `/api/courses/quiz-questions/${encodeURIComponent(questionId)}/check`,
    { method: "POST", body: JSON.stringify({ optionId }) },
  );
}

/* ── Authoring ───────────────────────────────────────────────────────────── */

export interface QuizDraft {
  instructions?: string | null;
  /** Null or omitted keeps it ungated, which is the default. */
  passPercent?: number | null;
  maxAttempts?: number | null;
}

/** Turn a lesson into a quiz lesson. One quiz per lesson. */
export function createQuiz(lessonId: string, draft: QuizDraft = {}) {
  return apiClient<{ id: string }>(
    `/api/courses/lessons/${encodeURIComponent(lessonId)}/quiz`,
    { method: "POST", body: JSON.stringify(draft) },
  );
}

export function updateQuiz(quizId: string, patch: QuizDraft) {
  return apiClient<{ id: string }>(`/api/courses/quizzes/${encodeURIComponent(quizId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** The lesson stays and stops being a quiz. */
export function deleteQuiz(quizId: string) {
  return apiClient<void>(`/api/courses/quizzes/${encodeURIComponent(quizId)}`, { method: "DELETE" });
}

export function createQuizQuestion(
  quizId: string,
  draft: { prompt: string; feedback?: string | null; options?: { label: string; isCorrect?: boolean }[] },
) {
  return apiClient<{ id: string }>(
    `/api/courses/quizzes/${encodeURIComponent(quizId)}/questions`,
    { method: "POST", body: JSON.stringify(draft) },
  );
}

export function updateQuizQuestion(
  questionId: string,
  patch: { prompt?: string; feedback?: string | null },
) {
  return apiClient<{ id: string }>(
    `/api/courses/quiz-questions/${encodeURIComponent(questionId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function deleteQuizQuestion(questionId: string) {
  return apiClient<void>(`/api/courses/quiz-questions/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
  });
}

/**
 * Reorder, sending the WHOLE list.
 *
 * The server rejects anything that is not a permutation of exactly this quiz's
 * questions, for the same reason sections and lessons do: a partial list
 * silently leaves the omitted ones at their old positions.
 */
export function reorderQuizQuestions(quizId: string, questionIds: string[]) {
  return apiClient<void>(
    `/api/courses/quizzes/${encodeURIComponent(quizId)}/questions/order`,
    { method: "PUT", body: JSON.stringify({ questionIds }) },
  );
}

/**
 * Replace a question's options.
 *
 * Not per-option CRUD: the options of a single-answer question are one coupled
 * thing, and editing them one at a time passes through states where none is
 * correct or two are. The server insists on exactly one correct answer and
 * between two and six options.
 */
export function replaceQuizOptions(
  questionId: string,
  options: { label: string; isCorrect?: boolean }[],
) {
  return apiClient<void>(
    `/api/courses/quiz-questions/${encodeURIComponent(questionId)}/options`,
    { method: "PUT", body: JSON.stringify({ options }) },
  );
}
