"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CircleDot,
  GripVertical,
  Loader2,
  Plus,
  ToggleLeft,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AddCard, ChoiceCard, ModalButton, ModalFooter, NumberStepper } from "./BuilderModal.client";
import {
  createQuizQuestion,
  deleteQuizQuestion,
  getQuizAsAuthor,
  replaceQuizOptions,
  reorderQuizQuestions,
  updateQuiz,
  updateQuizQuestion,
  type QuizAuthored,
  type QuizQuestionAuthored,
} from "../lib/api-learning-quizzes";

/**
 * Writing a quiz.
 *
 * ── The one real decision is asked in words, not as a field ────────────────
 *
 * Everything here is ordinary CRUD except the gating switch, which is the only
 * choice with a cost attached. Easygenerator measured 45,214 courses: adding a
 * single GRADED question drops completion from 90.7% to 72.3%, and 80% of the
 * people recorded as not finishing had watched everything and merely missed the
 * mark.
 *
 * So there is no "pass mark" input sitting at 80 waiting to be accepted. There
 * is a question with two answers, defaulted to the cheap one, and the cost of
 * the other is written underneath it. An author who wants to certify competence
 * will find it; an author who never thought about it does not pay eighteen
 * points of completion for a setting they did not know they had chosen.
 *
 * ── Every write is followed by a re-read ───────────────────────────────────
 *
 * Same rule as CourseBuilder next door: the server owns `order` across siblings
 * and rejects option sets that do not have exactly one correct answer, so local
 * state that guessed at the result would show an author a quiz that is not the
 * one their learners will get.
 *
 * ── This file is a set of STEPS, not a screen ──────────────────────────────
 *
 * Nothing here renders a dialog of its own any more. Each export below is one
 * body of the lesson dialog's sheet, and that dialog owns which one is showing.
 *
 * It used to be a single screen: an accordion of questions, whose reorder
 * buttons appeared on hover (so on a phone they never appeared), inside a
 * dialog whose Marking settings opened a SECOND dialog on top of the first.
 * Opening question 3 pushed 4 and 5 off the sheet. The admin app's onboarding
 * form builder is the shape this now follows - a flat list you drag, a card
 * picker on the way in, one editor per item - with the difference that the
 * steps live in one sheet instead of a stack of modals.
 */

/* ────────────────────────────── plumbing ────────────────────────────── */

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The quiz, read once and shared by every step.
 *
 * It lives in the LESSON dialog rather than in any one step, because a step
 * change must not be a refetch: you would watch the questions you just
 * reordered disappear and come back on the way out of a question.
 */
export function useQuizAuthoring(quizId: string | null) {
  const [quiz, setQuiz] = useState<QuizAuthored | null>(null);
  const { busy, run } = useBusy();
  // Takes a nullable id so the lesson dialog can call it unconditionally: a
  // lesson and a quiz are the same row and the same dialog, and a hook cannot
  // be called behind an `if`.
  const refresh = useCallback(async () => {
    if (!quizId) return;
    setQuiz(await getQuizAsAuthor(quizId));
  }, [quizId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { quiz, refresh, busy, run };
}

/* ─────────────────────────── question types ─────────────────────────── */

export type QuestionKind = "choice" | "boolean";

/**
 * Two kinds, and they are the SAME stored record.
 *
 * The server wants between two and six options with exactly one correct, and
 * there is no type column anywhere in the model. "True or false" is that record
 * seeded with two fixed options and its add/remove controls hidden - a writing
 * shortcut, not a new shape - which is why it costs nothing to offer and why
 * the kind has to be DERIVED rather than read.
 *
 * Derivation is deliberately shallow: exactly two options whose labels are the
 * translated True and False. Rename one and it becomes a two-answer multiple
 * choice, which is exactly what it then is. A third type (more than one right
 * answer, or a typed answer) is an entry in QUESTION_TYPES plus a branch, but
 * it needs the API first: the server rejects an option set without exactly one
 * correct answer, and has nowhere to keep the strings a typed answer matches.
 */
export function questionKind(
  question: Pick<QuizQuestionAuthored, "options">,
  trueLabel: string,
  falseLabel: string,
): QuestionKind {
  if (question.options.length !== 2) return "choice";
  const labels = question.options.map((o) => o.label.trim().toLowerCase());
  return labels.includes(trueLabel.trim().toLowerCase()) && labels.includes(falseLabel.trim().toLowerCase())
    ? "boolean"
    : "choice";
}

const KIND_ICON: Record<QuestionKind, typeof CircleDot> = {
  choice: CircleDot,
  boolean: ToggleLeft,
};

/* ──────────────────────────── shared bits ──────────────────────────── */

/** A field that keeps its own draft and commits when you leave it. */
function InlineText({
  value,
  placeholder,
  onCommit,
  className,
  multiline,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft.trim());
  };
  const shared = `w-full bg-transparent border-none outline-none ${className ?? ""}`;
  if (multiline) {
    return (
      <textarea
        rows={3}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`${shared} resize-none`}
        style={{ color: "var(--text-color)" }}
      />
    );
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className={shared}
      style={{ color: "var(--text-color)" }}
    />
  );
}

/** The small caption that names a group of fields inside a step. */
function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mt-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">{children}</p>
  );
}

/**
 * The control that leaves a step.
 *
 * It is an ordinary muted ModalButton in the footer's button row, the same as
 * every other secondary action in the app. It used to be a ghost link pushed
 * to the far left by `mr-auto`, which made the one control every step has read
 * as a different KIND of thing from the controls beside it - a link among
 * buttons, alone at the other end of the sheet - when it is simply the
 * secondary action of that step.
 */
export function BackButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("learning.quiz");
  return (
    <ModalButton onClick={onClick} icon={<ChevronLeft size={14} aria-hidden="true" />}>
      {t("back")}
    </ModalButton>
  );
}

/* ─────────────────────── step 1: the quiz itself ─────────────────────── */

/**
 * One question, as a row in the list.
 *
 * It says what kind it is, what it asks, and how many answers it offers - and
 * it opens. Everything you can change about it lives in its own step, which is
 * what lets the row stay one line and one target. It used to be an accordion
 * header with a hover-revealed cluster of move-up, move-down and delete
 * hanging off the end of it.
 */
function QuestionRow({
  question,
  index,
  onOpen,
}: {
  question: QuizQuestionAuthored;
  index: number;
  onOpen: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const kind = questionKind(question, t("trueLabel"), t("falseLabel"));
  const Icon = KIND_ICON[kind];
  const correct = question.options.filter((o) => o.isCorrect).length;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  return (
    <li
      ref={setNodeRef}
      className="list-none"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <div className="group flex items-center gap-1 rounded-xl bg-white pr-2 ring-1 ring-zinc-100/0 transition-all duration-150 hover:ring-zinc-200">
        {/* Same handle as the outline's rows, same reasoning: thumb-sized and
            legible on a phone, small and faint where a pointer can reveal it.
            `touch-none` or the browser claims the gesture for scrolling. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("dragQuestion")}
          className="ml-0.5 grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-[var(--button-radius,0.5rem)] border-none bg-transparent text-zinc-400 transition-colors hover:text-zinc-500 active:cursor-grabbing sm:h-8 sm:w-6 sm:text-zinc-300"
        >
          <GripVertical className="h-[17px] w-[17px] sm:h-[15px] sm:w-[15px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--button-radius,0.75rem)] border-none bg-transparent py-2.5 pr-2 text-left cursor-pointer"
          style={{ color: "var(--text-color)" }}
        >
          <span className="w-3 shrink-0 text-right text-[11px] font-bold tabular-nums text-zinc-300">
            {index + 1}
          </span>
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500"
            aria-hidden="true"
          >
            <Icon size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {question.prompt || t("questionPrompt")}
            </span>
            <span className="block truncate text-[11px] text-zinc-400">
              {kind === "boolean"
                ? t("typeTrueFalse")
                : `${t("typeMultipleChoice")} · ${t("answerCount", { count: question.options.length })}`}
            </span>
          </span>
          {/* The one thing worth saying on the row rather than inside it: this
              question cannot be marked as it stands, and an author scanning a
              list of eight wants to find that without opening all eight. */}
          {correct !== 1 && (
            <span
              className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: "#fdecec", color: "#b4383b" }}
            >
              {t("needsAnAnswer")}
            </span>
          )}
          <ChevronRight
            size={15}
            className="shrink-0 text-zinc-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-zinc-400"
            aria-hidden="true"
          />
        </button>
      </div>
    </li>
  );
}

/**
 * Step 1's quiz half: the list of questions, and the way into Marking.
 *
 * The lesson dialog renders the title field and the description row above
 * this, because those belong to the LESSON a quiz is attached to.
 */
export function QuizPanel({
  quiz,
  busy,
  run,
  refresh,
  onAddQuestion,
  onOpenQuestion,
  onOpenMarking,
}: {
  quiz: QuizAuthored;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onAddQuestion: () => void;
  onOpenQuestion: (id: string) => void;
  onOpenMarking: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const ids = quiz.questions.map((q) => q.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void run(async () => {
      await reorderQuizQuestions(quiz.id, move(ids, from, to));
      await refresh();
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <StepLabel>{t("questionsLabel")}</StepLabel>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="m-0 flex list-none flex-col gap-1 rounded-2xl bg-zinc-50 p-1.5">
            {quiz.questions.length === 0 ? (
              <li className="list-none px-3 py-5 text-center text-[12.5px] text-zinc-400">
                {t("noQuestions")}
              </li>
            ) : (
              quiz.questions.map((question, index) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  index={index}
                  onOpen={() => onOpenQuestion(question.id)}
                />
              ))
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {/*
        * The same card that adds a lesson or a quiz on the outline, not a text
        * link. This is the primary thing you do in here, and it was the only
        * "add" in the whole builder still drawn as 12px of underlined-looking
        * text while its siblings one screen back were full-width cards.
        */}
      <AddCard
        compact
        title={t("addQuestion")}
        hint={t("addQuestionHint")}
        onClick={onAddQuestion}
        disabled={busy}
      />

      <button
        type="button"
        onClick={onOpenMarking}
        disabled={busy}
        className="group mt-1 flex w-full cursor-pointer items-center gap-3 rounded-[var(--button-radius,1rem)] border-none bg-zinc-50 px-4 py-3 text-left transition-colors hover:bg-zinc-100 disabled:opacity-50"
        style={{ color: "var(--text-color)" }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">{t("markingLabel")}</span>
          <span className="block truncate text-[12px] text-zinc-500">
            {quiz.passPercent !== null
              ? t("gatingOnSummary", { percent: quiz.passPercent })
              : t("gatingOffSummary")}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-zinc-300" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ───────────────────── step: pick a question type ───────────────────── */

export function QuestionTypePicker({
  busy,
  onPick,
  onBack,
}: {
  busy: boolean;
  onPick: (kind: QuestionKind) => void;
  onBack: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const types: { kind: QuestionKind; title: string; hint: string }[] = [
    { kind: "choice", title: t("typeMultipleChoice"), hint: t("typeMultipleChoiceHint") },
    { kind: "boolean", title: t("typeTrueFalse"), hint: t("typeTrueFalseHint") },
  ];
  return (
    <>
      {/*
        * Cards rather than a dropdown, and the hint is the reason. "True or
        * false" and "Multiple choice" are both obvious as words; which one to
        * reach for is not, and a select option has room for neither sentence.
        */}
      <div className="flex flex-col gap-2">
        {types.map(({ kind, title, hint }) => {
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              disabled={busy}
              onClick={() => onPick(kind)}
              className="flex w-full items-center gap-3 rounded-[var(--button-radius,1rem)] border-[1.5px] border-solid border-zinc-200 bg-transparent p-3.5 text-left cursor-pointer transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
              style={{ color: "var(--text-color)" }}
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-500"
                aria-hidden="true"
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold">{title}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed opacity-60">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <ModalFooter>
        <BackButton onClick={onBack} />
      </ModalFooter>
    </>
  );
}

/* ────────────────────── step: one question, alone ────────────────────── */

export function QuestionEditor({
  question,
  busy,
  run,
  refresh,
  onBack,
}: {
  question: QuizQuestionAuthored;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onBack: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const [options, setOptions] = useState(question.options.map((o) => ({ ...o })));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOptions(question.options.map((o) => ({ ...o })));
  }, [question.options]);

  const kind = questionKind(question, t("trueLabel"), t("falseLabel"));
  const fixedAnswers = kind === "boolean";

  /*
   * Options are written as a SET, because that is the only write the API has:
   * there is no per-option create or delete, and the server validates the whole
   * set (two to six, exactly one correct). A failed write puts the server's
   * version back rather than leaving the screen showing something that was
   * rejected.
   */
  const saveOptions = (next: { label: string; isCorrect: boolean }[]) =>
    run(async () => {
      setError(null);
      try {
        await replaceQuizOptions(
          question.id,
          next.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
        setOptions(question.options.map((o) => ({ ...o })));
      }
    });

  return (
    <>
      <div className="flex flex-col gap-2">
        <StepLabel>{t("questionLabel")}</StepLabel>
        <div className="rounded-xl bg-zinc-50 px-4 py-3">
          <InlineText
            value={question.prompt}
            placeholder={t("questionPrompt")}
            multiline
            className="text-[13.5px] font-medium leading-relaxed"
            onCommit={(prompt) => {
              if (!prompt) return;
              void run(async () => {
                await updateQuizQuestion(question.id, { prompt });
                await refresh();
              });
            }}
          />
        </div>

        <StepLabel>{fixedAnswers ? t("answersLabelFixed") : t("answersLabel")}</StepLabel>
        {options.map((option, i) => (
          <div key={option.id || `new-${i}`} className="flex items-center gap-2.5">
            {/*
              * The radio keeps a deliberately oversized padded label around a
              * 17px control: the dot itself is well under any touch-target
              * guideline, and marking the right answer is the one thing this
              * step exists for.
              */}
            <label className="-m-2 flex shrink-0 cursor-pointer items-center p-2">
              <input
                type="radio"
                name={`correct-${question.id}`}
                checked={option.isCorrect}
                onChange={() => {
                  const next = options.map((o, j) => ({ ...o, isCorrect: j === i }));
                  setOptions(next);
                  void saveOptions(next);
                }}
                aria-label={t("markCorrect")}
                className="h-[17px] w-[17px] cursor-pointer"
                style={{ accentColor: "var(--brand-color, #18181b)" }}
              />
            </label>
            <input
              type="text"
              value={option.label}
              placeholder={t("answerPlaceholder")}
              readOnly={fixedAnswers}
              onChange={(e) => {
                const next = options.slice();
                next[i] = { ...next[i], label: e.target.value };
                setOptions(next);
              }}
              onBlur={() => {
                if (option.label !== question.options[i]?.label) void saveOptions(options);
              }}
              className="min-w-0 flex-1 rounded-[var(--button-radius,0.75rem)] border-none bg-zinc-50 px-3.5 py-2.5 text-[13px] outline-none read-only:opacity-70"
              style={{ color: "var(--text-color)" }}
            />
            {!fixedAnswers && options.length > 2 && (
              <button
                type="button"
                aria-label={t("removeAnswer")}
                disabled={busy}
                onClick={() => {
                  const next = options.filter((_, j) => j !== i);
                  setOptions(next);
                  void saveOptions(next);
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--button-radius,0.5rem)] border-none bg-transparent text-zinc-300 cursor-pointer transition-colors hover:text-zinc-500 disabled:opacity-40"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}

        {!fixedAnswers && options.length < 6 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setOptions([...options, { id: "", label: "", isCorrect: false, order: options.length }])
            }
            className="inline-flex items-center gap-1.5 self-start rounded-[var(--button-radius,0.5rem)] border-none bg-transparent px-1 py-1.5 text-[12.5px] font-semibold cursor-pointer transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: "var(--text-color)" }}
          >
            <Plus size={14} aria-hidden="true" />
            {t("addAnswer")}
          </button>
        )}

        <StepLabel>{t("feedbackLabel")}</StepLabel>
        <div className="rounded-xl bg-zinc-50 px-4 py-3">
          <InlineText
            value={question.feedback ?? ""}
            placeholder={t("feedbackPlaceholder")}
            multiline
            className="text-[12.5px] leading-relaxed"
            onCommit={(feedback) => {
              void run(async () => {
                await updateQuizQuestion(question.id, { feedback: feedback || null });
                await refresh();
              });
            }}
          />
        </div>

        {error && <p className="m-0 text-[12px]" style={{ color: "#b91c1c" }}>{error}</p>}
        {busy && <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" />}
      </div>

      {/*
        * No Move up / Move down here.
        *
        * Questions are reordered by DRAGGING their row in the list, which is
        * the same gesture the course outline uses for modules and lessons, so
        * there is one way to reorder anything in this builder rather than a
        * different one per level.
        *
        * KNOWN GAP: WCAG 2.5.7 asks for a SINGLE-POINTER alternative to a
        * dragging movement, and a keyboard path does not supply one. There is
        * no such alternative for a question, exactly as there is none for a
        * lesson or a quiz row on the outline. Restoring a pair of buttons here
        * (or chevrons on the row) is what would close it.
        */}
      <ModalFooter>
        <BackButton onClick={onBack} />
        <ModalButton
          tone="danger"
          disabled={busy}
          icon={<Trash2 size={14} aria-hidden="true" />}
          onClick={() =>
            void run(async () => {
              await deleteQuizQuestion(question.id);
              await refresh();
              onBack();
            })
          }
        >
          {t("removeQuestion")}
        </ModalButton>
      </ModalFooter>
    </>
  );
}

/* ───────────────────────── step: how it is marked ───────────────────────── */

export function QuizMarkingEditor({
  quiz,
  busy,
  run,
  refresh,
  onBack,
}: {
  quiz: QuizAuthored;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onBack: () => void;
}) {
  const t = useTranslations("learning.quiz");
  const gated = quiz.passPercent !== null;
  const patch = (body: Parameters<typeof updateQuiz>[1]) =>
    run(async () => {
      await updateQuiz(quiz.id, body);
      await refresh();
    });

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("gatingTitle")}>
          <ChoiceCard
            selected={!gated}
            title={t("gatingOff")}
            hint={t("gatingOffNote")}
            disabled={busy}
            onSelect={() => void patch({ passPercent: null })}
          />
          <ChoiceCard
            selected={gated}
            title={t("gatingOn")}
            hint={t("gatingOnNote")}
            disabled={busy}
            onSelect={() => {
              if (!gated) void patch({ passPercent: 70 });
            }}
          />
        </div>

        {gated && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
            <span className="min-w-0 flex-1 text-[13px] font-semibold">{t("passMarkLabel")}</span>
            {/*
              * The same stepper that sets stock on a product variant. A pass
              * mark is nudged far more often than it is typed - 70 to 75, 60
              * to 65 - and a bare number field made the commonest edit a
              * select-and-retype.
              */}
            <NumberStepper
              value={String(quiz.passPercent ?? 70)}
              min={1}
              max={100}
              suffix="%"
              disabled={busy}
              ariaLabel={t("passMarkLabel")}
              onChange={(next) => {
                const value = Number(next);
                // Ignore nonsense rather than saving it: it is a percentage
                // and the server would reject it anyway.
                if (!Number.isInteger(value) || value < 1 || value > 100) return;
                void patch({ passPercent: value });
              }}
            />
          </div>
        )}

        {/*
          * maxAttempts and instructions have been on the model, and writable
          * through this same PATCH, since quizzes shipped. Nothing ever
          * rendered a control for either, so every quiz on the platform has
          * silently had unlimited tries and no preamble.
          */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{t("attemptsLabel")}</span>
            <span className="block text-[12px] text-zinc-500">{t("attemptsHint")}</span>
          </span>
          {/*
            * Empty is a real value here and it is the default, which is why
            * the stepper carries a string: unlimited is not zero, and a field
            * that coerced a cleared box to 0 would quietly say "no tries at
            * all". The placeholder names it so the empty box is not a blank.
            */}
          <NumberStepper
            value={quiz.maxAttempts === null ? "" : String(quiz.maxAttempts)}
            min={1}
            max={99}
            placeholder={t("attemptsUnlimited")}
            disabled={busy}
            ariaLabel={t("attemptsLabel")}
            onChange={(next) => {
              const raw = next.trim();
              if (raw === "") {
                if (quiz.maxAttempts !== null) void patch({ maxAttempts: null });
                return;
              }
              const value = Number(raw);
              if (!Number.isInteger(value) || value < 1 || value > 99) return;
              void patch({ maxAttempts: value });
            }}
          />
        </div>

        <StepLabel>{t("instructionsLabel")}</StepLabel>
        <div className="rounded-xl bg-zinc-50 px-4 py-3">
          <InlineText
            value={quiz.instructions ?? ""}
            placeholder={t("instructionsPlaceholder")}
            multiline
            className="text-[12.5px] leading-relaxed"
            onCommit={(next) => void patch({ instructions: next || null })}
          />
        </div>
      </div>

      <ModalFooter>
        <BackButton onClick={onBack} />
      </ModalFooter>
    </>
  );
}

/* ───────────────────────────── creating one ───────────────────────────── */

/**
 * Seeds for a new question of each kind.
 *
 * True or false is seeded with its two options already correct-marked, because
 * a question the server considers invalid the moment it is created is a red
 * pill on a row somebody has not written yet.
 */
export function useCreateQuestion(quizId: string | null, refresh: () => Promise<void>) {
  const t = useTranslations("learning.quiz");
  return useCallback(
    async (kind: QuestionKind) => {
      if (!quizId) throw new Error("no quiz");
      const created = await createQuizQuestion(
        quizId,
        kind === "boolean"
          ? {
              prompt: t("newStatement"),
              options: [
                { label: t("trueLabel"), isCorrect: true },
                { label: t("falseLabel") },
              ],
            }
          : {
              prompt: t("newQuestion"),
              options: [{ label: t("answerA"), isCorrect: true }, { label: t("answerB") }],
            },
      );
      await refresh();
      return created.id;
    },
    [quizId, refresh, t],
  );
}
