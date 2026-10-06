"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import {
  checkQuizAnswer,
  getQuiz,
  submitQuizAttempt,
  type Quiz,
  type QuizCheck,
  type QuizResult,
} from "../lib/api-learning-quizzes";

/**
 * Taking a quiz.
 *
 * ── One question at a time, marked as you go ───────────────────────────────
 *
 * Not a form with a Submit at the bottom. A quiz marked at the end is a test;
 * a quiz marked as you go is a lesson, and the explanation under a wrong answer
 * is where the teaching actually happens. Answering the whole thing and being
 * told "3 of 4" without being shown which one is the version that teaches
 * nothing.
 *
 * Each answer is marked by `checkQuizAnswer`, which records NOTHING. The score
 * is written once, by the attempt at the end, so wandering off half way through
 * leaves no trace and checking a question twice is not two attempts.
 *
 * ── Skip is always available ───────────────────────────────────────────────
 *
 * A knowledge check that cannot be skipped is a wall in the middle of a course
 * somebody paid for. Skipping counts the question as wrong, because scoring out
 * of questions attempted would let someone answer the one they knew and score
 * 100%; that is a fair trade only because an ungated quiz's score costs them
 * nothing.
 *
 * ── The score is never computed here ───────────────────────────────────────
 *
 * The server strips `isCorrect` before this component ever sees a question, so
 * it could not mark anything. The marked paper arrives with the attempt, and
 * only then does this know which option was right.
 */

type Phase = "loading" | "taking" | "done";

export function QuizPlayer({
  quizId,
  onPassed,
}: {
  quizId: string;
  /** Fires once, when an attempt completes the lesson. */
  onPassed?: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** The option this learner clicked for the question on screen. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The marking of the question on screen, once it has been answered. */
  const [checked, setChecked] = useState<QuizCheck | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  /**
   * TWO error states, because they are two different situations and merging
   * them is a bug I shipped once already.
   *
   * `loadError` is terminal: there is no quiz to show, usually because this
   * person has not bought the course, so the component renders that sentence
   * INSTEAD of a quiz. `error` is recoverable: a check or a submit failed, the
   * quiz is still on screen and still usable, so it renders BESIDE it.
   *
   * With one state, a failed per-question check hit the terminal branch and
   * replaced the whole quiz with an error line - losing the answers somebody
   * had already given, for a failure that costs only an explanation.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = await getQuiz(quizId);
      setQuiz(q);
      setPhase("taking");
    } catch {
      /*
       * A 404 here is the ordinary answer for somebody who has not bought the
       * course, so it is not an error state with a retry - it is a quiz they
       * cannot see. The parent decides whether to render this at all.
       */
      setLoadError(t("unavailable"));
      setPhase("done");
    }
  }, [quizId, t]);

  useEffect(() => { void load(); }, [load]);

  if (phase === "loading") {
    return <p className="text-sm opacity-50"><Loader2 size={14} className="animate-spin inline mr-1.5" aria-hidden="true" />{t("loading")}</p>;
  }
  if (loadError) return <p className="text-sm opacity-60">{loadError}</p>;
  if (!quiz) return null;

  const total = quiz.questions.length;
  const question = quiz.questions[index];
  const isLast = index === total - 1;

  /**
   * Record the score, once, at the end.
   *
   * The per-question checks above wrote nothing, so this is the only call that
   * leaves a trace - which is what makes it safe to answer three questions,
   * close the tab, and not have a half-finished paper scored against you.
   */
  const commit = async (finalAnswers: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const marked = await submitQuizAttempt(quizId, finalAnswers);
      setResult(marked);
      if (marked.passed) onPassed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Answer the question on screen: mark it, show why, and wait.
   *
   * It does NOT advance on its own. Auto-advancing would show the explanation
   * for a third of a second and then take it away, which is the same as not
   * showing it - and the explanation is the reason this is a lesson rather
   * than a test.
   */
  const answer = async (optionId: string | null) => {
    const next = optionId ? { ...answers, [question.id]: optionId } : { ...answers };
    setAnswers(next);
    setPicked(optionId);
    setBusy(true);
    setError(null);
    try {
      setChecked(await checkQuizAnswer(question.id, optionId));
    } catch (err) {
      /*
       * A failed check must not cost them the answer. The pick stands, the
       * quiz carries on, and the score at the end is computed server-side from
       * the answers - so the only thing lost is the explanation.
       */
      setError(err instanceof Error ? err.message : t("checkFailed"));
      setChecked({ questionId: question.id, correct: false, correctOptionId: null, feedback: null });
    } finally {
      setBusy(false);
    }
  };

  /** Move on, or hand the paper in if this was the last one. */
  const next = async () => {
    if (isLast) {
      await commit(answers);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
    setChecked(null);
  };

  /* ── The result ──────────────────────────────────────────────────────── */
  if (result) {
    const gated = result.passPercent !== null;
    return (
      <div className="rounded-2xl bg-zinc-50 p-5">
        <div className="text-center">
          <p className="text-[30px] font-extrabold leading-none tracking-tight tabular-nums m-0"
            style={{ color: result.passed ? "#18845c" : "var(--text-color)" }}>
            {t("scoreOf", { correct: result.correct, total: result.total })}
          </p>
          <p className="text-[13px] opacity-60 m-0 mt-2">
            {/*
              * Three different sentences, because they are three different
              * situations. An ungated quiz has no verdict to give: saying
              * "passed" about a knowledge check invents a bar that was never
              * set. A gated failure names the mark and offers the way back in
              * the same breath, because 70% of learners who fail eventually
              * pass and this screen's job is to read as a pause.
              */}
            {!gated
              ? t("ungatedDone")
              : result.passed
                ? t("gatedPassed")
                : t("gatedFailed", { passPercent: result.passPercent ?? 0 })}
          </p>
        </div>

        <ul className="list-none m-0 p-0 mt-5 flex flex-col gap-2.5">
          {result.questions.map((q, i) => {
            const right = q.options.find((o) => o.isCorrect);
            const chosen = q.options.find((o) => o.id === q.chosenOptionId);
            const gotIt = !!chosen?.isCorrect;
            return (
              <li key={q.id} className="rounded-xl bg-white p-3">
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 mt-0.5" style={{ color: gotIt ? "#18845c" : "#b4383b" }}>
                    {gotIt ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium m-0">{i + 1}. {q.prompt}</p>
                    {!gotIt && (
                      <p className="text-[12.5px] opacity-70 m-0 mt-1">
                        {/* What they picked, then what was right. Naming only
                            the right answer leaves them guessing at what they
                            actually chose. */}
                        {chosen
                          ? t("youChose", { label: chosen.label })
                          : t("youSkipped")}
                        {" · "}
                        {t("theAnswerWas", { label: right?.label ?? "" })}
                      </p>
                    )}
                    {q.feedback && (
                      <p className="text-[12.5px] opacity-75 m-0 mt-1.5 leading-relaxed">{q.feedback}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => {
            setResult(null);
            setAnswers({});
            setIndex(0);
            setPicked(null);
          }}
          className="mt-4 w-full rounded-[var(--button-radius,0.75rem)] py-2.5 text-[13px] font-semibold cursor-pointer border-none"
          style={{ background: "var(--brand-color, #18181b)", color: "var(--brand-contrast, #fff)" }}
        >
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  /* ── Taking it ───────────────────────────────────────────────────────── */
  if (total === 0) return <p className="text-sm opacity-50">{t("noQuestionsYet")}</p>;

  return (
    <div className="rounded-2xl bg-zinc-50 p-5">
      <p className="text-[12px] opacity-50 m-0 tabular-nums">
        {t("questionOf", { index: index + 1, total })}
      </p>
      <p className="text-[15px] font-semibold m-0 mt-1.5 mb-3.5">{question.prompt}</p>

      <div className="flex flex-col gap-2">
        {question.options.map((option) => {
          const isPicked = picked === option.id;
          /*
           * Three states once marked, and the third is the one that teaches:
           * the option they chose (right or wrong), AND the one that was right
           * when they missed it. Marking only their own answer leaves somebody
           * who got it wrong none the wiser.
           */
          const isRight = checked?.correctOptionId === option.id;
          const isWrongPick = !!checked && isPicked && !checked.correct;
          const background = isRight ? "#f2fbf6" : isWrongPick ? "#fdf4f4" : isPicked ? "rgba(198,131,70,.10)" : "#fff";
          const border = isRight ? "#bfe8d4" : isWrongPick ? "#f3c6c6" : isPicked ? "var(--brand-color, #18181b)" : "transparent";
          return (
            <button
              key={option.id}
              type="button"
              disabled={busy || !!checked}
              onClick={() => void answer(option.id)}
              className="w-full text-left rounded-[var(--button-radius,0.75rem)] px-3.5 py-2.5 text-[13.5px] transition-all duration-150 cursor-pointer disabled:cursor-default flex items-center gap-2.5"
              style={{ background, border: `1px solid ${border}`, color: "var(--text-color)" }}
            >
              <span className="flex-1 min-w-0">{option.label}</span>
              {/* An icon as well as a colour: right and wrong must not be
                  carried by hue alone. */}
              {isRight && <Check size={15} aria-hidden="true" style={{ color: "#18845c" }} />}
              {isWrongPick && <X size={15} aria-hidden="true" style={{ color: "#b4383b" }} />}
            </button>
          );
        })}
      </div>

      {checked && (
        <div className="mt-3.5">
          <p className="text-[13px] font-semibold m-0"
            style={{ color: checked.correct ? "#18845c" : "#b4383b" }}>
            {checked.correct ? t("gotItRight") : t("gotItWrong")}
          </p>
          {checked.feedback && (
            <p className="text-[12.5px] opacity-75 m-0 mt-1.5 leading-relaxed">{checked.feedback}</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void next()}
            className="mt-3 w-full rounded-[var(--button-radius,0.75rem)] py-2.5 text-[13px] font-semibold cursor-pointer border-none disabled:opacity-50"
            style={{ background: "var(--brand-color, #18181b)", color: "var(--brand-contrast, #fff)" }}
          >
            {isLast ? t("finish") : t("nextQuestion")}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 mt-3.5">
        <button
          type="button"
          /* Hidden once marked: "skip" after seeing the answer is not a skip. */
          hidden={!!checked}
          disabled={busy || !!checked}
          onClick={() => void answer(null)}
          className="bg-transparent border-none cursor-pointer text-[12.5px] opacity-55 hover:opacity-90 p-0 disabled:opacity-30"
          style={{ color: "var(--text-color)" }}
        >
          {t("skip")}
        </button>
        {busy && <Loader2 size={13} className="animate-spin opacity-50" aria-hidden="true" />}
        {/* The pass mark, said before they start rather than after they fail. */}
        {quiz.passPercent !== null && (
          <span className="ml-auto text-[11.5px] opacity-50">
            {t("needToPass", { passPercent: quiz.passPercent })}
          </span>
        )}
      </div>

      {error && <p className="text-xs mt-2 m-0" style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}
