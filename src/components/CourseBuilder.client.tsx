"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ModalSheet, SheetFooterButtons } from "./ModalSheet";
import { readYoutubeDuration } from "../lib/youtube-media";
import { AlertCircle, Unlock, Link as LinkIcon, Captions, Check, ChevronDown, ChevronRight, ChevronUp, Eye, FileText, FileX2, Film, Gauge, GripVertical, ListChecks, Loader2, Lock, Paperclip, Plus, Trash2, Upload } from "lucide-react";
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
import { AddCard, BuilderModal, ChoiceCard, ConfirmModal, ModalButton, ModalFooter } from "./BuilderModal.client";
import { RichTextEditor } from "@cobuntu/product-management-ui";
import { sanitizeRichDescription } from "../lib/sanitize-rich-text";
import { richTextIsEmpty } from "../lib/richTextIsEmpty";
import { isVideoFile } from "../lib/isVideoFile";
import type { CourseLesson, CourseLessonMedia, CourseSection } from "../lib/api-learning";
import { getCourseContentClient } from "../lib/api-learning";
import {
  createLesson,
  createSection,
  deleteLesson,
  deleteLessonMedia,
  deleteSection,
  reorderLessons,
  reorderSections,
  setPreviewBoundary,
  updateLesson,
  updateSection,
  uploadLessonMedia,
  uploadCourseFile,
  linkLessonVideo,
  type UploadTarget,
} from "../lib/api-learning-authoring";
import { UploadCancelled, overweightVideo } from "../lib/resumable-upload";
import { lessonNameFromFile } from "../lib/lessonNameFromFile";
import { runtimeLabel } from "../lib/courseRuntime";
import { createQuiz } from "../lib/api-learning-quizzes";
import {
  QuestionTypePicker,
  QuizMarkingEditor,
  QuizPanel,
  QuestionEditor,
  questionKind,
  useCreateQuestion,
  useQuizAuthoring,
} from "./QuizEditor.client";

/**
 * The course builder.
 *
 * ── Every write is followed by a re-read ───────────────────────────────────
 *
 * Nothing here patches local state from a response. The syllabus has derived
 * shape a client cannot recompute honestly — `order` values the server assigns,
 * `locked` computed per viewer, media rows the upload endpoint names — and a
 * builder that guesses at them shows the author a course that does not match
 * the one their buyers will get.
 *
 * The cost is a round trip per edit, on a page one person uses while building
 * something they will sell. That is the right side of the trade.
 *
 * ── Reordering writes the whole list ───────────────────────────────────────
 *
 * `order` is indexed and NOT unique, deliberately, so two rows may briefly hold
 * the same number without the database objecting. A "move this one to index N"
 * write would therefore leave a half-applied order behind on a failure, and
 * reads break ties on createdAt — which is not the order anybody chose. So a
 * move sends the entire id list.
 */

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
 * Drop many files, get many lessons.
 *
 * ── Why this is the headline feature of a course builder ────────────────────
 *
 * It is the difference between a ten-video course taking one gesture and taking
 * thirty clicks: add lesson, name it, open it, choose file, wait, repeat.
 * Thinkific's Content Uploader does exactly this and it is the thing every
 * review of it mentions.
 *
 * ── Sequential, not parallel, and that is deliberate ────────────────────────
 *
 * Ten videos fired at once would compete for the same uplink, so all ten crawl
 * and none finishes: the author watches ten bars at 4% instead of one course
 * filling in. One at a time means lesson three is watchable while lesson eight
 * is still uploading, and the progress line can name the file it is actually on.
 *
 * ── The row exists before its file lands ────────────────────────────────────
 *
 * Each lesson is CREATED first, then its file uploaded to it. So a failed
 * upload leaves a correctly named, correctly ordered lesson with no video,
 * which the author can retry from the row. The alternative - upload first,
 * create on success - loses the ordering when file six fails, because seven
 * and eight have already taken its place.
 */
interface BulkProgress {
    /** 0-100 for the file currently moving. A spinner on 86MB looks hung. */
    percent?: number;
    /** 1-based, for "3 of 10". */
    index: number;
    total: number;
    fileName: string;
}

/**
 * The notices a drop can produce: what is happening, what was skipped, what
 * went wrong, and what is worth a second thought.
 *
 * ── Why these became a component ───────────────────────────────────────────
 *
 * There were four of them and each was a bare <p> with a hex colour, dropped
 * into the page flow between the module cards. So an upload in progress, a
 * rejected worksheet and a failed video all had the same visual weight as the
 * body text around them, and the longest of them read as a paragraph of prose:
 *
 *   "These are heavier than most courses need: Course test video (30MB).mp4.
 *    They will play, but learners on phones will wait longer to start.
 *    Exporting at 1080p would look the same for most of them."
 *
 * Three sentences and a filename, run together on one line, in amber. The
 * filename is the part the author needs to find and it was buried mid-sentence
 * between two clauses of advice.
 *
 * ── The shape ──────────────────────────────────────────────────────────────
 *
 * A headline that says what happened, one quieter line of why, and the
 * FILENAMES as their own rows rather than comma-joined into the prose. That
 * last part is the whole point: a list of files is a list, and writing it as a
 * sentence makes the reader parse grammar to find a filename.
 *
 * Colours come from the vocabulary this file already speaks (the amber of the
 * missing-captions chip, the red of the delete confirm) rather than a new set,
 * so a notice looks like it belongs to the builder it appears in.
 */
const NOTICE_TONES = {
    /* Neutral, not brand. Progress is not an achievement and a brand-coloured
       panel for "something is happening" competes with the actual primary. */
    busy: { bg: "rgba(128,128,128,0.08)", fg: "#52525b", bar: "var(--brand-color, #52525b)" },
    caution: { bg: "#fff4de", fg: "#95681a", bar: "#95681a" },
    problem: { bg: "#fdecec", fg: "#b91c1c", bar: "#b91c1c" },
} as const;

export function UploadNotice({
    tone,
    icon,
    title,
    body,
    files,
    percent,
    trailing,
}: {
    tone: keyof typeof NOTICE_TONES;
    icon: React.ReactNode;
    title: string;
    body?: string;
    /** Named, one per row. See the note above: a file list is not a sentence. */
    files?: string[];
    /** 0-100 draws a bar across the foot of the card. */
    percent?: number;
    /** A figure that belongs on the title line, like "82%". */
    trailing?: string;
}) {
    const t = NOTICE_TONES[tone];
    return (
        <div
            className="flex gap-3 rounded-xl px-3.5 py-3"
            style={{ background: t.bg, color: t.fg }}
            role={tone === "problem" ? "alert" : "status"}
        >
            {/* The icon sits on the first LINE, not centred against a block that
                may be four rows tall. */}
            <span className="mt-[1px] shrink-0" aria-hidden="true">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                    <p className="m-0 text-[13px] font-semibold leading-snug">{title}</p>
                    {trailing && (
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums opacity-80">{trailing}</span>
                    )}
                </div>
                {body && <p className="m-0 mt-1 text-[12.5px] leading-relaxed opacity-80">{body}</p>}
                {files && files.length > 0 && (
                    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                        {files.map((f) => (
                            /* TRUNCATED, with the full name on `title`. A
                               filename can be arbitrarily long and have no
                               spaces to wrap at, so left alone it pushes the
                               card wider than the column it sits in. The head
                               of the name is the identifying part. */
                            <li
                                key={f}
                                className="truncate rounded-md px-2 py-1 text-[12px] font-medium"
                                style={{ background: "color-mix(in srgb, currentColor 10%, transparent)" }}
                                title={f}
                            >
                                {f}
                            </li>
                        ))}
                    </ul>
                )}
                {percent !== undefined && (
                    /* A real bar. The figure alone cannot be read at a glance,
                       and an 86MB upload behind a line of text looks hung. */
                    <span
                        className="mt-2.5 block h-[3px] w-full overflow-hidden rounded-full"
                        style={{ background: "color-mix(in srgb, currentColor 18%, transparent)" }}
                    >
                        <span
                            className="block h-full rounded-full transition-[width] duration-300 ease-out"
                            style={{ width: `${Math.max(2, percent)}%`, background: t.bar }}
                        />
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * Paste a link to a video that lives somewhere else.
 *
 * ── Why this sits under the drop zone and not beside it ────────────────────
 *
 * Uploading is the default, and it stays the larger target, because it is the
 * one that keeps a paid course paid. Linking is the alternative for an author
 * who already has the video on YouTube - a real request from a seller - so it
 * reads as the quieter of two options rather than an equal choice.
 *
 * ── The warning is the point, not decoration ───────────────────────────────
 *
 * A linked lesson has NO paywall and cannot have one. Private YouTube videos
 * are not embeddable at all, so the only embeddable options are public and
 * unlisted, and an unlisted URL is a permanent, transferable key: anyone it is
 * pasted to watches forever without buying. Our signed playback URLs and the
 * `locked` contract simply do not apply.
 *
 * That is a real trade an author is entitled to make about their own material,
 * and it was decided they may (2026-10-02). What they are not entitled to is
 * making it by accident, so the warning is stated before they paste, in plain
 * terms, rather than tucked into a tooltip afterwards.
 */
/**
 * Paste a link to a video that lives somewhere else.
 *
 * ── A MODAL, not an inline panel ───────────────────────────────────────────
 *
 * It expanded in place at first, which pushed the module's contents down the
 * page the moment it opened and put a decision - one with a four-line warning
 * attached - inside a row of small secondary controls. The warning is the most
 * consequential sentence in this whole flow and it was competing with "Add a
 * quiz" for attention.
 *
 * A modal is what this app uses when an action needs the reader's whole
 * attention before they commit (see PwywAmountModal, which moved out of a
 * column for the same reason). It also means the warning is read against a
 * dimmed page rather than skimmed past.
 *
 * ── The warning is the feature ─────────────────────────────────────────────
 *
 * A linked lesson has NO paywall and cannot have one. Private YouTube videos
 * are not embeddable at all, so the only embeddable options are public and
 * unlisted, and an unlisted URL is a permanent, transferable key: anyone it is
 * pasted to watches forever without buying.
 *
 * That is a real trade an author may make about their own material, and it was
 * decided they may (2026-10-02). What they must not do is make it by accident,
 * so it is stated before they commit, with what to do instead.
 */
function LinkVideoRow({
    target,
    disabled,
    onLinked,
}: {
    /*
     * A LESSON that already exists. The SECTION case used to come through here
     * too, from a button under the drop zone; both sources now live together
     * in AddLessonCard's dialog, so what is left is the per-lesson strip.
     */
    target: UploadTarget | (() => Promise<UploadTarget>);
    disabled?: boolean;
    onLinked: () => Promise<void>;
}) {
    const t = useTranslations("learning.builder");
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Sits in the lesson's own action strip, in the same shape as
                "add a file" and "add captions" beside it. */}
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[var(--button-radius,0.5rem)] border-none bg-transparent px-2 py-1.5 text-[11.5px] font-medium text-zinc-600 cursor-pointer transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"
            >
                <LinkIcon size={13} aria-hidden="true" />
                {t("linkVideoShort")}
            </button>
            {/* Link ONLY. This trigger belongs to a lesson that already exists,
                and that lesson's own strip already carries its upload control -
                offering a second one here would be two ways to do the same
                thing a centimetre apart. */}
            <AddVideoLessonModal
                open={open}
                onClose={() => setOpen(false)}
                target={target}
                onAdded={onLinked}
            />
        </>
    );
}

function useBulkUpload(onChanged: () => Promise<void>) {
    const [progress, setProgress] = useState<BulkProgress | null>(null);
    const [failed, setFailed] = useState<string[]>([]);
    /** The first lesson a drop created, so the caller can focus its title. */
    const [firstCreatedId, setFirstCreatedId] = useState<string | null>(null);

    /*
     * ── WHY each failure is now explained, and used to end the run ─────────
     *
     * This used to be `catch { missed.push(file.name) }`. The upload layer
     * built a perfectly good message from the response and this threw it away,
     * so a seller whose 86 MB video was refused by Vercel's 4.5 MB body cap was
     * told only "these did not upload, drop them in again to retry" - advice
     * that could not work, for a reason nothing on the page could state.
     *
     * So the reason is kept. And when the FIRST file fails for a reason that
     * will obviously repeat, the rest of the queue is abandoned rather than
     * marched through: ten files behind a broken connection is ten pointless
     * uploads and a ten-name error, when the honest answer is one sentence.
     */
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);

    const upload = useCallback(async (sectionId: string, files: File[]) => {
        setFailed([]);
        setFirstCreatedId(null);
        setError(null);
        setWarning(null);
        const missed: string[] = [];
        const heavy: string[] = [];
        let first: string | null = null;
        let lastError: string | null = null;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setProgress({ index: i + 1, total: files.length, fileName: file.name, percent: 0 });
            try {
                /*
                 * The LESSON is created by the server, after the bytes land.
                 *
                 * It used to be created here, first, and an upload that then
                 * failed left a row reading "No video yet". The only advice
                 * given was to try again, so three attempts left three empty
                 * lessons and a wizard refusing to continue for want of a
                 * video. Nothing is written now unless the file arrives.
                 */
                const media = await uploadCourseFile({ sectionId }, file, {
                    /* "01-welcome-final.mp4" -> "Welcome". The server only
                       strips the extension, as a fallback; this is the rule. */
                    title: lessonNameFromFile(file.name),
                    onProgress: (p) => setProgress({
                        index: i + 1, total: files.length, fileName: file.name, percent: p.percent,
                    }),
                });
                if (!first) first = media.lessonId ?? null;

                const heavyFile = overweightVideo(file.size, media.durationSeconds ?? null);
                if (heavyFile) heavy.push(file.name);
            } catch (err) {
                if (err instanceof UploadCancelled) break;
                lastError = err instanceof Error ? err.message : null;
                missed.push(file.name);
            }
        }

        setProgress(null);
        setFailed(missed);
        setError(lastError);
        setFirstCreatedId(first);
        if (heavy.length) setWarning(heavy.join(", "));
        await onChanged();
    }, [onChanged]);

    return { upload, progress, failed, firstCreatedId, error, warning };
}

/**
 * The surface files are dropped onto.
 *
 * Also a button, and that is not belt-and-braces: a drop target that can only
 * be dropped on excludes anyone who cannot drag, which WCAG 2.2 treats as a
 * failure rather than a gap (SC 2.5.7). The click path is the same code.
 */
function DropZone({
    onFiles,
    onRejected,
    disabled,
    title,
    hint,
    compact,
    onActivate,
}: {
    onFiles: (files: File[]) => void;
    /** Names of files that were not videos, so the caller can say so. */
    onRejected?: (names: string[]) => void;
    disabled?: boolean;
    title: string;
    hint?: string;
    compact?: boolean;
    /**
     * What a CLICK does, when it should not be "open the file picker".
     *
     * The builder's card now opens a dialog offering both sources, so clicking
     * it must not jump straight to the file picker and quietly rule the other
     * one out. Dropping is unaffected either way: a file already in hand is an
     * answer to the question the dialog would have asked.
     */
    onActivate?: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);

    /*
     * ── Only videos become lessons ─────────────────────────────────────────
     *
     * This zone makes a LESSON per file, and a lesson is a video. A PDF
     * dropped here used to become a lesson with nothing to play in it: a row
     * in the syllabus, sold with the course, that opens on an empty player.
     *
     * `accept` on the input is half of it and the weaker half - it filters the
     * file PICKER, which is a hint the browser is free to ignore, and a DROP
     * never consults it at all. So the same rule is applied to the files
     * themselves, on both paths.
     *
     * Rejected files are NAMED rather than counted, because the author needs
     * to know which one to put somewhere else - and the answer is usually "as
     * an attachment inside a lesson", which is where a worksheet belongs.
     */
    const take = (list: FileList | null) => {
        const files = Array.from(list ?? []);
        if (!files.length) return;
        const videos = files.filter(isVideoFile);
        const rejected = files.filter((f) => !isVideoFile(f));
        if (rejected.length) onRejected?.(rejected.map((f) => f.name));
        if (videos.length) onFiles(videos);
    };

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
            /*
             * Three states, not two, and they have to be distinguishable at a
             * glance while a file is under the cursor:
             *
             *   rest      quiet dashed outline on the page's own grey
             *   hover     border firms up, surface lifts to white, icon grows
             *   dragover  the brand colour, a tinted fill, and a ring
             *
             * The dragover state is the one that matters: somebody holding a
             * file needs to know THIS is the thing that will catch it, and a
             * border that only darkens a shade does not say so. It is also the
             * state nobody sees by accident, so it can be loud.
             */
            /*
             * The SAME radius token AddCard uses, not a fixed 16px.
             *
             * These sit side by side - "Add lessons" beside "Add a quiz", with
             * "Add module" under them - and this one was `rounded-2xl` while
             * the others follow `--button-radius`. On any community whose
             * button radius is not 16px the three cards in one row had three
             * different corners; on Cobuntu, at 8px, it is plainly visible.
             */
            className={`group rounded-[var(--button-radius,1rem)] border-[1.5px] border-dashed transition-all duration-150 ${
                compact ? "flex items-center gap-3 bg-white px-4 py-6 text-left" : "px-5 py-9 text-center"
            } ${
                over
                    ? "bg-[rgba(0,0,0,0.03)]"
                    : `border-zinc-300 hover:border-zinc-400 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-18px_rgba(60,40,30,0.55)] active:translate-y-0 ${
                          compact ? "hover:bg-zinc-50/60" : "bg-zinc-50/70 hover:bg-white"
                      }`
            } ${disabled ? "opacity-50" : "cursor-pointer"}`}
            /*
             * The dragover ring is an inline box-shadow, not a Tailwind `ring`
             * class. The brand colour is a CSS variable, and Tailwind cannot
             * apply an opacity modifier to an arbitrary var - `ring-[color:var
             * (--brand-color)]/25` compiles to something that does not carry
             * the alpha, so the ring came out either solid or absent depending
             * on the build. color-mix keeps the tint and keeps the variable.
             */
            style={
                over
                    ? {
                          borderColor: "var(--brand-color, #18181b)",
                          boxShadow: "0 0 0 3px color-mix(in srgb, var(--brand-color, #18181b) 22%, transparent)",
                      }
                    : undefined
            }
            onClick={() => { if (disabled) return; if (onActivate) onActivate(); else inputRef.current?.click(); }}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                // The types the SERVER takes, same list the per-lesson video
                // input uses: what a browser plays without a transcode step.
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                    // Cleared so the same selection fires change again, which is
                    // what a retry after a failure depends on.
                    const list = e.target.files;
                    take(list);
                    e.target.value = "";
                }}
            />
            {/*
              * The icon tile grows on hover and again while a file is over it,
              * so the zone reacts before anything is dropped.
              *
              * The compact one wears the SAME tile as AddCard - 32px, zinc-100,
              * darkening and growing on hover - because it sits in a row with
              * "Add lesson" and "Add a quiz" and is the same kind of offer.
              * Without it, the third button in a row of three was the one with
              * no icon and no lift, which read as a disabled label.
              */}
            <span
                className={
                    compact
                        ? `grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-zinc-100 text-zinc-500 transition-all duration-150 ${
                              over ? "scale-110" : "group-hover:bg-zinc-200 group-hover:text-zinc-700 group-hover:scale-105"
                          }`
                        : `mx-auto mb-2.5 grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)] transition-transform duration-200 ${
                              over ? "scale-110" : "group-hover:scale-105"
                          }`
                }
                aria-hidden="true"
            >
                <Upload size={compact ? 18 : 19} className={compact ? undefined : "text-zinc-400"} />
            </span>
            <span className={compact ? "min-w-0" : undefined}>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => { e.stopPropagation(); if (onActivate) onActivate(); else inputRef.current?.click(); }}
                    className={`bg-transparent border-none p-0 font-semibold ${
                        compact ? "block text-[13px] text-zinc-900" : "text-sm"
                    } ${disabled ? "" : "cursor-pointer"}`}
                    style={compact ? undefined : { color: "var(--text-color)" }}
                >
                    {title}
                </button>
                {hint && (
                    <span className={compact ? "mt-0.5 block text-[11.5px] text-zinc-500" : "mt-1 block text-xs opacity-55"}>
                        {hint}
                    </span>
                )}
            </span>
        </div>
    );
}

/**
 * Both ways to put a video in a course, in one dialog.
 *
 * ── Why they were merged ────────────────────────────────────────────────────
 *
 * There used to be a drop zone with a second, quieter button underneath it:
 * "Or link a video you have online". That shape says the two are not the same
 * kind of thing, and ranks them before the author has said what they have. An
 * author whose video is already on YouTube read the big target first, and the
 * small grey line under it last, if at all.
 *
 * They ARE the same thing: both answer "where is the video". So the card asks
 * the question and this dialog holds both answers, side by side, neither of
 * them a footnote to the other.
 *
 * ── The two halves commit differently, on purpose ───────────────────────────
 *
 * Choosing a file IS the decision - the upload starts and the dialog closes,
 * because a confirm step after a file picker is a second click for a choice
 * already made. A link is typed, so it can be half-typed, and it needs a
 * moment where it is checked against YouTube before it becomes a lesson. That
 * is what the footer's primary is for, and why it reads on the link rather
 * than on the dialog as a whole.
 */
export function AddVideoLessonModal({
    open,
    onClose,
    target,
    onAdded,
    onFiles,
    onRejected,
}: {
    open: boolean;
    onClose: () => void;
    /** A section, a lesson, or a way to make the section that does not exist yet. */
    target: UploadTarget | (() => Promise<UploadTarget>);
    onAdded: () => Promise<void>;
    /**
     * Present only where uploading is one of the answers. The per-lesson strip
     * passes nothing, and the dialog is then the link form alone.
     */
    onFiles?: (files: File[]) => void;
    onRejected?: (names: string[]) => void;
}) {
    const t = useTranslations("learning.builder");
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /*
     * Whether this is the dialog with both answers in it, or the link form on
     * its own. It changes what the dialog is CALLED, not just what it shows:
     * headed "Add a video lesson" and subtitled "Upload a file, or..." with no
     * upload half on screen, it promises something it does not offer. Caught by
     * rendering it, not by reading it.
     */
    const both = !!onFiles;

    /* Nothing survives a close. A URL left in the field reappears next time
       against a different module, which is a lesson in the wrong place. */
    useEffect(() => {
        if (!open) { setUrl(""); setError(null); }
    }, [open]);

    const submit = async () => {
        if (!url.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
            /*
             * The RUNTIME, read from a throwaway player before submitting.
             *
             * oEmbed does not report duration, so without this a linked lesson
             * stores none and a course mixing uploaded and linked lessons shows
             * "12 min" on some rows and nothing on others. Best effort: if it
             * cannot be read the link still goes through, and the syllabus is
             * simply quiet about length.
             */
            const durationSeconds = (await readYoutubeDuration(url.trim())) ?? undefined;
            const resolved = typeof target === "function" ? await target() : target;
            await linkLessonVideo(resolved, { url: url.trim(), durationSeconds });
            onClose();
            await onAdded();
        } catch (err) {
            /* The server's words. It distinguishes "that is not a YouTube link"
               from "YouTube will not confirm that video", and the second is the
               one that tells an author their video is private or has embedding
               turned off - which they cannot see from their own browser,
               because they are signed in as its owner. */
            setError(err instanceof Error ? err.message : t("linkFailed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <ModalSheet
            open={open}
            onClose={onClose}
            busy={busy}
            title={both ? t("addVideoTitle") : t("linkVideoLabel")}
            subtitle={both ? t("addVideoSubtitle") : t("linkVideoExplainer")}
            closeLabel={t("close")}
            footer={
                <SheetFooterButtons
                    onCancel={onClose}
                    onConfirm={() => void submit()}
                    cancelLabel={t("close")}
                    confirmLabel={busy ? t("linkVideoBusy") : t("linkVideoConfirm")}
                    confirmDisabled={!url.trim()}
                    busy={busy}
                />
            }
        >
            {both && onFiles && (
                <>
                    <DropZone
                        onFiles={(files) => { onFiles(files); onClose(); }}
                        onRejected={onRejected}
                        disabled={busy}
                        title={t("addVideoUploadTitle")}
                        /* The existing hint, which is already translated in
                           every locale and says exactly what this zone does.
                           A new key here would have shipped as English. */
                        hint={t("addLessonHint")}
                    />

                    {/* A labelled rule, not a heading. The two halves are peers,
                        and a second <h3> under the dialog's own title would rank
                        one of them. */}
                    <div className="my-4 flex items-center gap-3" aria-hidden="true">
                        <span className="h-px flex-1" style={{ background: "rgba(128,128,128,0.2)" }} />
                        <span className="text-[11.5px] font-medium uppercase tracking-wide" style={{ color: "var(--text-color)", opacity: 0.45 }}>
                            {t("addVideoOr")}
                        </span>
                        <span className="h-px flex-1" style={{ background: "rgba(128,128,128,0.2)" }} />
                    </div>
                </>
            )}

            {/* The field's own heading, which exists to separate it from the
                upload half. On its own the dialog's title already says this,
                and repeating it is the same words twice in 40px. */}
            {both && (
                <label className="mb-1.5 block text-[13px] font-semibold" style={{ color: "var(--text-color)" }}>
                    {t("linkVideoLabel")}
                </label>
            )}
            <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); void submit(); } }}
                placeholder={t("linkVideoPlaceholder")}
                aria-label={t("linkVideoLabel")}
                className="w-full px-3.5 text-[15px] outline-none"
                style={{
                    border: "1px solid rgba(128,128,128,0.2)",
                    borderRadius: "var(--input-radius, 8px)",
                    background: "var(--bg-color)",
                    color: "var(--text-color)",
                    minHeight: 48,
                }}
            />

            {/*
              * ── The warning ────────────────────────────────────────────────
              *
              * It was four lines of amber prose. A paragraph in a warning
              * colour reads as an error the reader has already caused, and
              * amber on white is the hardest text in the dialog to actually
              * read - so the one thing that most needed reading was the thing
              * people skimmed.
              *
              * The SIGNAL is the icon and a short bold line; the explanation is
              * ordinary ink at reading contrast. Nothing has gone wrong here,
              * so nothing should look like it has: this is a consequence being
              * explained before a choice.
              */}
            <div className="mt-3 flex gap-3 rounded-xl p-3" style={{ background: "rgba(128,128,128,0.07)" }}>
                <Unlock size={16} strokeWidth={2} aria-hidden="true" className="mt-[1px] shrink-0" style={{ color: "#95681a" }} />
                <div className="min-w-0">
                    <p className="m-0 text-[13px] font-semibold" style={{ color: "var(--text-color)" }}>
                        {t("linkVideoWarnTitle")}
                    </p>
                    <p className="m-0 mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-color)", opacity: 0.65 }}>
                        {t("linkVideoWarning")}
                    </p>
                </div>
            </div>

            {error && <p className="m-0 mt-2 text-[12.5px]" style={{ color: "#b91c1c" }}>{error}</p>}
        </ModalSheet>
    );
}

/**
 * The card that asks "where is the video", and the dialog it opens.
 *
 * Still a drop target: a file already dragged over the page is an answer, and
 * making that person open a dialog to say it again would be a step added for
 * the sake of symmetry. Clicking opens the dialog, because a click means the
 * answer has not been given yet.
 */
function AddLessonCard({
    target,
    onFiles,
    onRejected,
    onAdded,
    disabled,
}: {
    target: UploadTarget | (() => Promise<UploadTarget>);
    onFiles: (files: File[]) => void;
    onRejected?: (names: string[]) => void;
    onAdded: () => Promise<void>;
    disabled?: boolean;
}) {
    const t = useTranslations("learning.builder");
    const [open, setOpen] = useState(false);

    return (
        <>
            <DropZone
                compact
                onFiles={onFiles}
                onRejected={onRejected}
                disabled={disabled}
                title={t("addLessonCardTitle")}
                hint={t("addLessonCardHint")}
                onActivate={() => setOpen(true)}
            />
            <AddVideoLessonModal
                open={open}
                onClose={() => setOpen(false)}
                target={target}
                onAdded={onAdded}
                onFiles={onFiles}
                onRejected={onRejected}
            />
        </>
    );
}

/**
 * One thing you can open, as a row: icon, label, what is in it, chevron.
 *
 * Copied in shape from ProductForm's detail rows (the "Add description / Add
 * tags / Choose a category" stack on the step before this one) so the course
 * wizard answers "there is a setting here" the way the rest of the wizard
 * already does. Same lift on hover, same chevron nudge, same check-in-a-brand-
 * circle once it is filled.
 *
 * `bg-white` rather than ProductForm's `bg-zinc-50`, because inside a section
 * card the page's grey IS the card, and a grey row on a grey card is invisible.
 */
function SettingRow({
  icon,
  label,
  preview,
  done,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  /** What is currently in it, one line, shown under the label. */
  preview?: string;
  done?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-[var(--button-radius,1rem)] border-none bg-white px-4 py-3 text-left ring-1 ring-zinc-100/0 transition-all duration-150 hover:-translate-y-0.5 hover:ring-zinc-200 hover:shadow-[0_10px_22px_-16px_rgba(60,40,30,0.5)] active:translate-y-0 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {done ? (
        <span
          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-white"
          style={{ background: "var(--brand-color, #18181b)" }}
          aria-hidden="true"
        >
          <Check size={12} strokeWidth={3.5} />
        </span>
      ) : (
        <span className="shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-500">{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] ${done ? "font-medium text-zinc-800" : "text-zinc-500"}`}>
          {label}
        </span>
        {preview && <span className="block truncate text-[12px] text-zinc-500">{preview}</span>}
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-zinc-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-zinc-400"
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The first line of a rich-text value, as plain text, for a row's preview.
 *
 * The stored value is HTML, so putting it in a row verbatim would print the
 * tags. Entities are decoded for the handful Quill actually emits rather than
 * through a DOM parse: this runs for every section and lesson on every render,
 * and it must not depend on `document` when the page renders on the server.
 */
function plainSnippet(html: string, max = 90): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

/** Text input that commits on blur, so a rename is not a write per keystroke. */
function InlineText({
  value,
  placeholder,
  onCommit,
  className,
  selectOnMount,
}: {
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
  className?: string;
  /**
   * Focus this field and select what is in it, once, on mount.
   *
   * Set on the first lesson a bulk drop created. The name came from a
   * filename, so it is a guess: selecting it means accepting the guess costs
   * nothing and replacing it costs one keystroke rather than a click, a
   * select-all and a delete. Only the FIRST, because stealing focus into row
   * six while somebody is typing in row one is worse than not helping at all.
   */
  selectOnMount?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectOnMount) return;
    ref.current?.focus();
    ref.current?.select();
    // Mount only: re-running would yank focus back on every parent re-render,
    // and this component re-renders on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={ref}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      /*
       * Committed on blur and on Enter, never on change. A PATCH per keystroke
       * would put a course title through thirty writes and race its own
       * responses, so the last one to land could be the shortest prefix.
       */
      onBlur={() => draft !== value && onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className={`bg-transparent border-none outline-none ${className ?? ""}`}
      style={{ color: "var(--text-color)" }}
    />
  );
}

/**
 * The description on a section or a lesson.
 *
 * ── Why this is a rich-text field and not a textarea ───────────────────────
 *
 * Both columns have existed since the first migration and nothing ever wrote
 * to them, so every course shipped as a list of bare titles. What an author
 * needs to say here - what this chapter covers, what to have open while you
 * watch, a link to the repo - is the same kind of writing the product
 * description takes, and that is Quill everywhere else in this app. A second,
 * plainer editor for the same job would mean a course whose overview is
 * formatted and whose lessons are not.
 *
 * ── Why the editor lives in a dialog ───────────────────────────────────────
 *
 * In the row, it is READ ONLY: nothing, or the prose itself. Writing opens a
 * dialog. Two reasons. Quill is a heavy dynamic import with a visible
 * toolbar, and a course with six sections and twenty lessons would otherwise
 * mount twenty-six of them. And an editor that expands in place pushes the
 * rest of the outline a screenful down, so you lose sight of the course while
 * writing about it. The page is for arranging lessons; a wall of toolbars is
 * not an arrangement.
 *
 * ── Why it saves on an explicit Save ───────────────────────────────────────
 *
 * Unlike InlineText, which commits on blur. Blur inside a Quill surface fires
 * when you reach for the bold button, and a field that writes to the server
 * every time the caret leaves the text would turn one paragraph into a dozen
 * PATCHes. Escape discards, which is the other half of that bargain.
 */
/**
 * The editor itself: a rich-text surface and the two buttons that end it.
 *
 * Separate from the row that opens it, because there are now two places the
 * same editor has to appear and they do not agree on what surrounds it. From
 * the outline a module's description opens a dialog of its own. From inside a
 * lesson or quiz dialog it is step 2 of THAT dialog, which already has a
 * header and a way back and must not grow a second one.
 */
export function DescriptionEditor({
  value,
  placeholder,
  disabled,
  cancelLabel,
  onCancel,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  /**
   * What the leave-without-saving button says. It defaults to "Cancel",
   * which is right when this editor IS the dialog: the button closes the
   * whole thing. As step 2 of a lesson dialog it closes nothing, it returns
   * you to step 1, so there it says "Back" instead. Same behaviour either
   * way - only the promise the word makes about where you land differs.
   */
  cancelLabel?: string;
  onCancel: () => void;
  onSave: (next: string | null) => void;
}) {
  const t = useTranslations("learning.builder");
  const [draft, setDraft] = useState(value ?? "");
  return (
    <>
      {/*
        * Fills whatever the sheet has left, rather than sitting at its own
        * 250px and leaving the rest of a fixed-height panel blank under it.
        *
        * RichTextEditor takes no className - it renders a `.rich-text-editor`
        * wrapper around Quill, whose own CSS sets `min-height: 250px` on the
        * container and the editing surface. So the chain of `flex-1` has to be
        * pushed down through it from here with arbitrary variants: wrapper,
        * then Quill's container, then the editable area. `min-h-0` at each
        * level or the 250px floor wins and the box overflows instead of
        * scrolling inside itself.
        */}
      <div className="flex min-h-0 flex-1 flex-col [&_.ql-container]:min-h-0 [&_.ql-container]:flex-1 [&_.ql-editor]:min-h-0 [&_.rich-text-editor]:flex [&_.rich-text-editor]:min-h-0 [&_.rich-text-editor]:flex-1 [&_.rich-text-editor]:flex-col">
        <RichTextEditor content={draft} onChange={setDraft} placeholder={placeholder} />
      </div>
      {/*
        * Right-aligned, and each button only as wide as its own word. Save was
        * `flex-1`, so in a 520px dialog it became a 600px-wide bar next to a
        * small Cancel - a button whose size says "this is the only thing on
        * the screen" for an action that is one of two.
        */}
      <ModalFooter>
        <ModalButton onClick={onCancel}>{cancelLabel ?? t("cancelDescription")}</ModalButton>
        <ModalButton
          tone="primary"
          disabled={disabled}
          onClick={() => {
            // Quill's empty document is "<p><br></p>", not "" - see
            // richTextIsEmpty for why that has to be normalised to null.
            const html = draft.trim();
            onSave(richTextIsEmpty(html) ? null : html);
          }}
        >
          {t("saveDescription")}
        </ModalButton>
      </ModalFooter>
    </>
  );
}

function DescriptionField({
  value,
  onSave,
  disabled,
  addLabel,
  placeholder,
  modalTitle,
}: {
  value: string | null;
  onSave: (next: string | null) => void;
  disabled?: boolean;
  /** What the empty state offers, e.g. "Describe this section". */
  addLabel: string;
  placeholder: string;
  /** The dialog's heading, e.g. "Lesson description". */
  modalTitle: string;
}) {
  const t = useTranslations("learning.builder");
  const [editing, setEditing] = useState(false);

  if (!editing) {
    /*
     * A full-width row, the same one the wizard's own step before this uses
     * for "Add description" / "Add tags" / "Choose a category".
     *
     * It was a small pencil link with the prose rendered beside it, which made
     * a written description look like body copy that happened to have an edit
     * button, and an unwritten one look like a caption. The row says "there is
     * a thing here, it is either filled or it is not, and it opens" - and the
     * course wizard now answers that question in the same shape as the two
     * steps around it.
     */
    return (
      <SettingRow
        icon={<FileText size={17} aria-hidden="true" />}
        label={value ? t("descriptionLabel") : addLabel}
        preview={value ? plainSnippet(value) : undefined}
        done={!!value}
        disabled={disabled}
        onClick={() => setEditing(true)}
      />
    );
  }

  /*
   * Writing happens in a dialog, not in the row.
   *
   * Inline, a Quill toolbar and its editing surface pushed the lessons below
   * it a screenful down, so writing one paragraph meant losing sight of the
   * outline you were writing it for. The dialog also gives the editor a width
   * that is actually comfortable to write in - inline it inherited whatever
   * was left inside a nested lesson panel.
   */
  return (
    <BuilderModal title={modalTitle} onClose={() => setEditing(false)}>
      <DescriptionEditor
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onCancel={() => setEditing(false)}
        onSave={(next) => { setEditing(false); onSave(next); }}
      />
    </BuilderModal>
  );
}

/**
 * One file hanging off a lesson.
 *
 * The kind is carried by an ICON rather than the word "ATTACHMENT" in caps:
 * the row used to lead with a shouted enum value, which told the author what
 * the database calls it and nothing about the file. The name leads now, the
 * icon says what sort of thing it is, and the bin appears on hover so a list
 * of three files is three filenames rather than three delete buttons.
 */
function MediaRow({
  media,
  icon,
  meta,
  onDelete,
}: {
  media: CourseLessonMedia;
  icon: React.ReactNode;
  /** A short qualifier, such as a caption's language. */
  meta?: string;
  onDelete: () => void;
}) {
  const t = useTranslations("learning.builder");
  return (
    <li className="group/file flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-50">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]">{media.originalName}</span>
      {meta && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-100">
          {meta}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("removeFile")}
        className="shrink-0 rounded-[var(--button-radius,0.375rem)] border-none bg-transparent p-1 text-zinc-400 cursor-pointer opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover/file:opacity-100 focus:opacity-100"
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
    </li>
  );
}

function LessonRow({
  lesson,
  sectionId,
  siblingIds,
  index,
  count,
  onChanged,
  selectTitleOnMount,
  isLastFree,
  isFree,
  onSetBoundary,
}: {
  lesson: CourseLesson;
  /** The section this lesson sits in. Not on the lesson payload. */
  sectionId: string;
  /** Every lesson id in that section, in current order — reorder writes the
   *  whole list rather than one item's index. */
  siblingIds: string[];
  index: number;
  count: number;
  onChanged: () => Promise<void>;
  /** True for the first lesson a bulk drop just created. */
  selectTitleOnMount?: boolean;
  /** This lesson is the last free one: the line is drawn under it. */
  isLastFree?: boolean;
  /**
   * Which side of the paywall this row is on RIGHT NOW, which during a drag is
   * not what the server last saved. The row reads this rather than
   * `lesson.isPreview` so the marking follows the line while it is moving.
   */
  isFree?: boolean;
  /** Move the whole course's preview boundary. Null means no free preview. */
  onSetBoundary: (lastFreeLessonId: string | null) => void;
}) {
  const t = useTranslations("learning.builder");
  const tq = useTranslations("learning.quiz");
  const { busy, run } = useBusy();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /* 0-100 while a file moves, null when nothing is moving. An 86MB upload
     behind a bare spinner is indistinguishable from a hung page. */
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  /**
   * Attach a caption file.
   *
   * The language is asked for rather than guessed. A filename tells you
   * nothing reliable ("captions.vtt", "final.vtt"), and the document locale is
   * the AUTHOR's interface language, which is not necessarily the language they
   * teach in. Guessing wrong puts the wrong flag in a learner's captions menu,
   * and nothing downstream can correct it.
   */
  const onCaption = async (file: File) => {
    setUploadError(null);
    const language = window.prompt(t("captionLanguagePrompt"), "en")?.trim();
    if (!language) return;
    await run(async () => {
      try {
        await uploadLessonMedia(lesson.id, file, { language });
        await onChanged();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : t("uploadFailed"));
      }
    });
  };

  /**
   * Upload, with the kind decided by the BUTTON rather than by the file.
   *
   * It used to be inferred from the mime type, which meant the control saying
   * "add file" and the control that should have said "add video" were the same
   * control, and what you got depended on what you happened to pick.
   */
  const onFile = async (file: File, kind: "VIDEO" | "ATTACHMENT") => {
    setUploadError(null);
    setUploadPercent(0);
    await run(async () => {
      try {
        /*
         * Direct to the bucket, not through our API.
         *
         * A video cannot take the multipart route: that request is served by a
         * Next.js route on Vercel, which caps request bodies at 4.5 MB before
         * our code runs. Captions keep the old path deliberately - they are
         * capped at 2 MB, comfortably under it, and the server reads their
         * first bytes to check they really are WebVTT.
         */
        const media = await uploadCourseFile({ lessonId: lesson.id }, file, {
          kind,
          onProgress: (p) => setUploadPercent(p.percent),
        });
        const heavy = kind === "VIDEO"
          ? overweightVideo(file.size, media.durationSeconds ?? null)
          : null;
        /* The BODY only. The notice's own title already says "heavier than most
           courses need", and the sentence this used to hold said it again. */
        setUploadWarning(heavy ? t("noticeHeavyBodyOne", { mbps: Math.round(heavy.mbps) }) : null);
        await onChanged();
      } catch (err) {
        if (err instanceof UploadCancelled) return;
        /*
         * Surfaced, unlike the other failures on this page. An upload is the
         * one action here where the author has spent real time before the
         * failure, and silently dropping a two-gigabyte video reads as the page
         * ignoring them.
         */
        setUploadError(err instanceof Error ? err.message : t("uploadFailed"));
      } finally {
        setUploadPercent(null);
      }
    });
  };

  /*
   * Collapsed by default, expanded in place.
   *
   * The outline is the thing an author is reasoning about -- what order, what
   * is missing, how long it runs -- and a lesson's own settings are a detour
   * from it. Teachable makes a lesson a whole page and the outline disappears;
   * a drawer covers it. Expanding the row keeps both, which is how Skool does
   * it and why the row below stays a row.
   */
  const [open, setOpen] = useState(false);
  /*
   * A confirmation REPLACES the sheet that raised it, it does not sit on top.
   *
   * Two dialogs at once means two backdrops, so the sheet underneath dims to
   * roughly the same grey as the page and reads as a third surface nobody
   * asked for; Escape becomes ambiguous; and on a phone the stack is taller
   * than the viewport. It also puts the thing you are about to destroy behind
   * a scrim, which is precisely when you want to see it.
   *
   * So: raising the confirmation closes this sheet, and answering NO puts it
   * back exactly where it was. This flag is what remembers there was something
   * to put back - the row's trash button raises the same confirmation without
   * the sheet ever being open, and that case must not open it on cancel.
   */
  const [reopenAfterConfirm, setReopenAfterConfirm] = useState(false);
  const askDelete = () => {
    setReopenAfterConfirm(open);
    setOpen(false);
    setConfirmDelete(true);
  };
  /** Step 2 of the dialog above: writing this lesson's or quiz's description. */
  /*
   * Which body the sheet is showing.
   *
   * One union rather than a flag per surface, because these are mutually
   * exclusive by construction: the sheet shows exactly one thing, and a pair
   * of booleans can represent "writing the description AND editing question 3"
   * which is not a state that exists.
   */
  const [step, setStep] = useState<
    | { k: "root" }
    | { k: "description" }
    | { k: "marking" }
    | { k: "pickType" }
    | { k: "question"; id: string }
  >({ k: "root" });
  const toRoot = () => setStep({ k: "root" });

  const { quiz, refresh: refreshQuiz, busy: quizBusy, run: quizRun } = useQuizAuthoring(lesson.quizId);
  const createQuestion = useCreateQuestion(lesson.quizId, refreshQuiz);
  const currentQuestion =
    step.k === "question" ? quiz?.questions.find((q) => q.id === step.id) ?? null : null;

  /*
   * Drag to reorder, with the chevrons kept as the other way to do it.
   *
   * WCAG 2.5.7 is explicit that anything achievable by dragging must also be
   * achievable without, so the buttons are not a fallback to be removed later
   * - they are half of the requirement. dnd-kit's KeyboardSensor gives a third
   * path (space to lift, arrows to move) for free.
   *
   * The handle is its own element rather than the whole row, because the row
   * opens the lesson: a row that both opens on tap and drags on press has to
   * guess which one you meant, and it will be wrong often enough to lose an
   * edit or scramble an order.
   */
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: lesson.id,
  });
  /** The row's delete, waiting on an answer. */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const video = lesson.media.find((m) => m.kind === "VIDEO");
  const captions = lesson.media.filter((m) => m.kind === "CAPTION");
  /*
   * Attachments are everything that is neither the video nor a caption. A
   * caption counted as an attachment would tell an author their lesson has a
   * downloadable file, and send them looking for a .vtt in the downloads list.
   */
  const attachments = lesson.media.filter((m) => m.kind !== "VIDEO" && m.kind !== "CAPTION");
  const minutes = video?.durationSeconds ? Math.round(video.durationSeconds / 60) : null;

  return (
    <li
      ref={setNodeRef}
      className="list-none"
      /*
       * What the boundary drag aims at. `elementFromPoint` gives whatever tiny
       * span is under the cursor - a chip, a pill, an icon - so the row
       * announces itself on the outermost element and the drag walks up to it.
       */
      data-preview-target={lesson.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Lifted above its siblings while it moves, and faded so the gap it
        // came from stays readable as the place it will fall back into.
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      {/*
        * The row is ONE button that opens the lesson, plus reorder controls.
        *
        * It used to expand in place, with an inline title field and a pill
        * that was secretly a switch, so a row was four separate targets and
        * opening one pushed every row below it down the page. Everything you
        * can change about a lesson now lives in its dialog, which leaves the
        * row to do the job a row is good at: say what this lesson is, what
        * state it is in, and open it.
        */}
      {/*
        * White, ringed and lifting on hover: the same card the description row
        * above it wears, because they do the same thing - they open something.
        *
        * It used to be transparent at rest and only turn white under the
        * pointer, so a list of lessons read as plain text on the section's grey
        * and nothing said a row was pressable until you were already on it.
        * On a touch screen, where there is no pointer, nothing said it at all.
        */}
      {/*
        * A free row carries a rail down its left, so the preview reads as a
        * contiguous BLOCK at the top of the list rather than as a handful of
        * rows that happen to be marked. That is what the setting actually is.
        *
        * NEUTRAL, not green. The rail and the chip were #18845c, which made
        * this surface the most colourful thing in the product - a success
        * green on an editor where nothing has succeeded, next to a red delete,
        * on a page whose job is to be a quiet workspace. The signal is
        * positional (a continuous edge down one side); it never needed a hue
        * to carry it, and the one accent this page has is the community's own
        * brand, which is not ours to spend on a state marker.
        */}
      <div
        className={`group flex items-center gap-1 rounded-2xl bg-white pr-2 ring-1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-16px_rgba(60,40,30,0.5)] active:translate-y-0 ${
          isFree
            ? "ring-zinc-200 shadow-[inset_3px_0_0_0_rgb(161,161,170)] hover:ring-zinc-300"
            : "ring-zinc-100/0 hover:ring-zinc-200"
        }`}
      >
        {/*
          * `touch-none` is load-bearing: without it the browser claims the
          * gesture for scrolling and the drag never starts on a phone, which
          * is the case this was added for.
          */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("dragLesson")}
          /*
           * Bigger and darker on a phone, smaller on a desktop.
           *
           * On a desktop the handle can afford to be faint: the pointer
           * reveals it on hover and a mouse hits a 24px target reliably. A
           * phone has neither. There is no hover to discover it with, so at
           * zinc-300 it read as decoration, and 24x32 is under the 44px
           * minimum a thumb needs, on the ONE control here whose whole job
           * is to be grabbed and held.
           */
          className="ml-1 grid h-11 w-9 shrink-0 cursor-grab touch-none place-items-center rounded-[var(--button-radius,0.5rem)] border-none bg-transparent text-zinc-400 transition-colors hover:text-zinc-500 active:cursor-grabbing sm:h-8 sm:w-6 sm:text-zinc-300"
        >
          <GripVertical className="h-[18px] w-[18px] sm:h-[15px] sm:w-[15px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setOpen(true)}
          /*
           * One line, on every width.
           *
           * It used to stack on a phone - icon, then title, then a wrapped
           * strip of pills - which made a row three lines tall and a list of
           * six lessons a page of its own. Worse, a row is a single target
           * that opens a dialog, and a three-line target does not read as one
           * thing; the quiz row in particular came out as an icon, a title
           * and a lone chevron on three separate lines.
           *
           * It fits because the title truncates and the secondary pills drop
           * out below sm (see them), leaving icon + title + at most one pill
           * + chevron.
           */
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--button-radius,1rem)] border-none bg-transparent py-3 pr-3.5 text-left cursor-pointer sm:gap-3"
          style={{ color: "var(--text-color)" }}
        >
          {/*
            * What kind of thing this row is, before its name.
            *
            * A quiz announced itself with a pill on the far right, a video
            * lesson and a notes-only lesson announced nothing at all, and the
            * only way to tell a lesson with a video from one without was to
            * read a grey "No video yet" three columns over. The icon puts the
            * answer where the eye starts: film for a video lesson, paperclip
            * for one that is only files, a list for a quiz, and the document
            * for a lesson that is so far just a title.
            */}
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500"
            aria-hidden="true"
          >
            {/* Two kinds, because a section holds two kinds. A lesson with
                no video yet is still a lesson - its pill says the video is
                missing - not a third sort of thing. */}
            {lesson.quizId ? <ListChecks size={14} /> : <Film size={14} />}
          </span>

          <span className="w-full min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {lesson.title || t("lessonTitle")}
          </span>

          {/*
            * No wrapper of its own at any width: the pills are laid out by the
            * row. This used to be a flex box that wrapped them onto a second
            * line on a phone, which is what made the row multi-line.
            *
            * What keeps them from overflowing 375px instead is that only the
            * FIRST pill survives below sm. That one is mutually exclusive
            * (uploading, or a runtime, or "no video yet") so it is always at
            * most one, and it is the one carrying the state an author came
            * back to check. Captions and attachment counts are reference, not
            * status, and the dialog is a tap away.
            */}
          <span className="contents">

          {/*
            * Pills, in the order someone scans for them: is it free, how long
            * is it, is anything attached. A lesson with no video says so
            * plainly rather than showing nothing, because "no video yet" is the
            * state an author is looking for when they come back to finish.
            *
            * All of them are now plain spans. The access one used to be a
            * button, which could not live inside a row that is itself a button
            * - and it no longer needs to be, because the dialog this row opens
            * carries the setting.
            */}
          {/* No "Quiz" pill. The icon at the head of the row already says
              which kind of thing it is, and a word repeating it takes space
              from the pills that carry something the icon cannot - runtime,
              upload state, a missing video. */}
          {lesson.quizId ? null : busy ? (
            <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#fff4de", color: "#95681a" }}>
              {t("uploading")}
            </span>
          ) : minutes !== null ? (
            <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums" style={{ background: "#eef4ff", color: "#3560bd" }}>
              {runtimeLabel(t, minutes)}
            </span>
          ) : !video ? (
            <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold opacity-60" style={{ background: "rgba(128,128,128,0.12)" }}>
              {t("noVideo")}
            </span>
          ) : null}
          {video && (
            /*
             * Said on every lesson that has a video, present or absent, because
             * the ABSENCE is the state worth seeing: WCAG 1.2.2 is Level A, so
             * a video with no captions is a conformance gap rather than a
             * missing nicety, and an author scanning their outline should be
             * able to find the ones that still need a file.
             */
            <span
              className="hidden shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold sm:block"
              /* Only the ABSENCE is coloured. A video WITH captions is the
                 ordinary case and does not need a success green to say so;
                 the amber stays, because a missing caption file is a WCAG
                 Level A gap and that is worth one warning colour on a page
                 that otherwise has none. */
              style={captions.length > 0
                ? { background: "rgba(128,128,128,0.12)", color: "#52525b" }
                : { background: "#fff4de", color: "#95681a" }}
            >
              {captions.length > 0 ? t("hasCaptions") : t("noCaptions")}
            </span>
          )}
          {attachments.length > 0 && (
            <span className="hidden shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold opacity-70 sm:block" style={{ background: "rgba(128,128,128,0.12)" }}>
              {t("attachmentCount", { count: attachments.length })}
            </span>
          )}

          {/*
            * Which side of the paywall the row is on, said on EVERY row rather
            * than only on the boundary - the zone is the thing being edited, so
            * it has to be the thing you can see.
            *
            * It sits with the other badges now, BEFORE the chevron, rather than
            * out past it with the controls: it is a fact about the lesson, like
            * its length and its attachments, not a thing you can press. The
            * chevron stays the last mark in the row, which is what makes it
            * read as "this opens".
            */}
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold opacity-70"
            style={{ background: "rgba(128,128,128,0.12)" }}
          >
            {isFree ? t("freeChip") : t("lockedRow")}
          </span>

          </span>

          <ChevronRight
            size={16}
            className="shrink-0 text-zinc-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-zinc-400"
            aria-hidden="true"
          />
        </button>

        {/*
          * Delete, on the row, in red.
          *
          * It was only inside the dialog, so removing a lesson you can already
          * see meant opening it, scrolling past everything you did not come
          * for, and finding the footer. The confirmation is what makes it safe
          * to put back on the row.
          *
          * The reorder chevrons are gone from here: the row drags now, and two
          * ways to do the same thing on the same row is one control too many.
          *
          * KNOWN GAP: there is no longer a non-drag path at all. The dialog's
          * Move buttons were removed too, so dragging is the only way to
          * reorder a lesson or a quiz, and WCAG 2.5.7 asks for a SINGLE-
          * POINTER alternative to a dragging movement (a keyboard path does
          * not satisfy it). Modules still have their chevrons. Restoring
          * these closes it.
          */}
        {/*
          * Where the free preview ends, set from the row it ends at.
          *
          * It was a button inside the lesson dialog, which asked somebody to
          * decide where a sample of the course STOPS while looking at one
          * lesson and none of its neighbours. It is a property of the running
          * order, not of a lesson, so it belongs next to the running order -
          * and the line it draws (PreviewBoundaryLine, just below this row)
          * appears the moment it is pressed, which is the whole confirmation.
          *
          * Never on a quiz: a quiz is not a sample of anything, and somebody
          * who has not seen the lessons it tests will fail it.
          */}
        {/*
          * The row says WHICH SIDE of the paywall it is on, and it says it on
          * every row rather than only on the boundary.
          *
          * Before, the one free lesson at the edge went green and the two free
          * ones above it looked exactly like the locked ones below. The zone
          * was the thing being edited and the zone was the thing you could not
          * see, so "what does a buyer actually get" could only be answered by
          * counting rows against a line.
          */}

        {/*
          * The control that MOVES the boundary, named rather than drawn as an
          * eye. It was a 26px icon with no label, sitting next to a delete, and
          * the words "free preview" appeared nowhere on the page until after
          * you had pressed it.
          *
          * Not on the boundary row itself: that row has the line under it and
          * the panel above holds its Remove. Not on a quiz either - a quiz is
          * not a sample of anything, and somebody who has not seen the lessons
          * it tests will fail it. A quiz INSIDE the free range is fine and
          * shows as free; it just cannot be where the range ends.
          */}
        {!lesson.quizId && !isLastFree && (
          <button
            type="button"
            onClick={() => onSetBoundary(lesson.id)}
            disabled={busy}
            title={t("endPreviewHere")}
            /* ALWAYS VISIBLE. It was opacity-0 until the row was hovered, so
               the one control that moves the paywall was invisible at rest and
               absent entirely on a touch screen's first look. A control that
               appears only once you are already pointing at it cannot be
               found by somebody who does not know it is there. */
            className="hidden shrink-0 items-center gap-1.5 rounded-[var(--button-radius,0.5rem)] border-none px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40 sm:inline-flex"
            style={{ background: "rgba(128,128,128,0.10)", color: "#52525b" }}
          >
            <Eye size={13} aria-hidden="true" />
            {t("endPreviewHere")}
          </button>
        )}
        {/*
          * Touch has no hover, so the phone keeps an always-visible icon
          * button rather than a label that never appears.
          */}
        {!lesson.quizId && !isLastFree && (
          <button
            type="button"
            onClick={() => onSetBoundary(lesson.id)}
            disabled={busy}
            aria-label={t("endPreviewHere")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--button-radius,0.5rem)] border-none cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40 sm:hidden"
            style={{ background: "rgba(128,128,128,0.10)", color: "#71717a" }}
          >
            <Eye size={14} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={askDelete}
          disabled={busy}
          aria-label={lesson.quizId ? t("removeQuiz") : t("removeLesson")}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--button-radius,0.5rem)] border-none cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "#fdecec", color: "#b91c1c" }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        /*
         * One dialog per lesson, holding everything about it: its name, who
         * can watch it, what it says, and its files - or, for a quiz, its
         * questions. A quiz has no video and no free-preview switch, because a
         * quiz is never a preview: somebody who has not seen the lessons it
         * tests will fail it.
         */
        <BuilderModal
          title={
            step.k === "description"
              ? lesson.quizId ? t("quizDescriptionTitle") : t("lessonDescriptionTitle")
              : step.k === "marking"
                ? tq("gatingTitle")
                : step.k === "pickType"
                  ? tq("addQuestion")
                  : step.k === "question"
                    /* The kind, so the step says what you are writing. It is
                       DERIVED from the options - there is no type column - so
                       a question whose answers are not True and False reads as
                       the multiple choice it is. */
                    ? currentQuestion &&
                      questionKind(currentQuestion, tq("trueLabel"), tq("falseLabel")) === "boolean"
                      ? tq("typeTrueFalse")
                      : tq("typeMultipleChoice")
                    : lesson.quizId ? t("editQuiz") : t("editLesson")
          }
          onClose={() => { toRoot(); setOpen(false); }}
          /* Keyed by the step, and by WHICH question, so moving between two
             questions cross-fades rather than swapping the fields underneath
             a cursor that is already in one of them. */
          stepKey={step.k === "question" ? `question:${step.id}` : step.k}
          /*
           * Step 2 is the description. Same sheet, swapped contents - rather
           * than a dialog stacked on a dialog (two backdrops, two Escapes) or
           * an editor that expanded in the body and pushed the questions and
           * files below it off the screen.
           *
           * The way back is the footer's Back button and nothing else. It
           * used to ALSO be a crumb above the heading, which made the sheet
           * carry two controls for one move, at opposite ends, while the
           * page behind it already has a breadcrumb of its own. The footer
           * is where the other decision (Save) is, so it is where the hand
           * already is.
           */
        >
          {step.k === "description" ? (
            <DescriptionEditor
              value={lesson.description}
              placeholder={t("lessonDescriptionPlaceholder")}
              disabled={busy}
              cancelLabel={t("backStep")}
              onCancel={toRoot}
              onSave={(description) => {
                toRoot();
                void run(async () => {
                  await updateLesson(lesson.id, { description });
                  await onChanged();
                });
              }}
            />
          ) : step.k !== "root" && !quiz ? (
            /* A quiz step with nothing read yet. Falling through to the root
               body instead would flash the quiz you came from on the way into
               one of its questions. */
            <p className="m-0 text-[13px] opacity-50">{tq("loading")}</p>
          ) : step.k === "marking" && quiz ? (
            <QuizMarkingEditor
              quiz={quiz}
              busy={quizBusy}
              run={quizRun}
              refresh={refreshQuiz}
              onBack={toRoot}
            />
          ) : step.k === "pickType" && quiz ? (
            <QuestionTypePicker
              busy={quizBusy}
              onBack={toRoot}
              onPick={(kind) =>
                void quizRun(async () => {
                  // Straight into the new question, the way the admin form
                  // builder does: picking a type and then being handed back a
                  // list to find what you just made is a step for nothing.
                  const id = await createQuestion(kind);
                  setStep({ k: "question", id });
                })
              }
            />
          ) : step.k === "question" ? (
            currentQuestion ? (
              <QuestionEditor
                question={currentQuestion}
                busy={quizBusy}
                run={quizRun}
                refresh={refreshQuiz}
                onBack={toRoot}
              />
            ) : (
              /* Deleted from under us, or a stale id. Nothing to edit, so go
                 back rather than render an empty form. */
              <p className="m-0 text-[13px] opacity-50">{tq("loading")}</p>
            )
          ) : (
          <>
          <div className="flex flex-col gap-2.5">
            <InlineText
              value={lesson.title}
              placeholder={t("lessonTitle")}
              onCommit={(title) => title && run(async () => {
                await updateLesson(lesson.id, { title });
                await onChanged();
              })}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-[14px] font-semibold ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              selectOnMount={selectTitleOnMount}
            />

            {/* The row only OPENS the step; the editor itself is step 2. */}
            <SettingRow
              icon={<FileText size={17} aria-hidden="true" />}
              label={
                lesson.description
                  ? t("descriptionLabel")
                  : lesson.quizId ? t("addQuizDescription") : t("addLessonDescription")
              }
              preview={lesson.description ? plainSnippet(lesson.description) : undefined}
              done={!!lesson.description}
              disabled={busy}
              onClick={() => setStep({ k: "description" })}
            />
          </div>

          {lesson.quizId ? (
            quiz ? (
              <QuizPanel
                quiz={quiz}
                busy={quizBusy}
                run={quizRun}
                refresh={refreshQuiz}
                onAddQuestion={() => setStep({ k: "pickType" })}
                onOpenQuestion={(id) => setStep({ k: "question", id })}
                onOpenMarking={() => setStep({ k: "marking" })}
              />
            ) : (
              <p className="m-0 mt-3 text-[13px] opacity-50">{tq("loading")}</p>
            )
          ) : (
        <div className="mt-3">
          {/*
            * Grouped by WHAT THE THING IS, not by "media".
            *
            * It used to be one undifferentiated list - a row reading
            * "ATTACHMENT Diogo Cesar - CV.pdf" beside a tiny bin, under a raw
            * checkbox, above two identical text links. Everything on it looked
            * equally important and nothing said which slot was empty.
            *
            * A lesson has one video and any number of things hanging off it, so
            * the panel says that: a video slot that is either filled or
            * obviously empty, then attachments, then captions. Each group only
            * appears when it has something OR when it is the one thing missing.
            */}

          {/* ── The video ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-zinc-400 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
              <Film size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              {video ? (
                <>
                  <span className="block truncate text-[12.5px] font-medium">{video.originalName}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {minutes !== null ? runtimeLabel(t, minutes) : t("videoNoDuration")}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[12.5px] font-medium text-zinc-500">{t("noVideoYet")}</span>
                  <span className="block text-[11px] text-zinc-400">{t("noVideoHint")}</span>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => videoRef.current?.click()}
              disabled={busy}
              className="shrink-0 rounded-[var(--button-radius,0.5rem)] bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-white border-none cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : (video ? t("replaceVideo") : t("addVideo"))}
            </button>
            {video && (
              <button
                type="button"
                onClick={() => run(async () => { await deleteLessonMedia(video.id); await onChanged(); })}
                aria-label={t("removeFile")}
                className="shrink-0 rounded-[var(--button-radius,0.5rem)] border-none bg-transparent p-1.5 text-zinc-400 cursor-pointer hover:bg-zinc-100 hover:text-zinc-700"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* ── Attachments ──────────────────────────────────────────── */}
          {attachments.length > 0 && (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {attachments.map((m) => (
                <MediaRow
                  key={m.id}
                  media={m}
                  icon={<Paperclip size={13} aria-hidden="true" />}
                  onDelete={() => run(async () => { await deleteLessonMedia(m.id); await onChanged(); })}
                />
              ))}
            </ul>
          )}

          {/* ── Captions ─────────────────────────────────────────────── */}
          {captions.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
              {captions.map((m) => (
                <MediaRow
                  key={m.id}
                  media={m}
                  icon={<Captions size={13} aria-hidden="true" />}
                  meta={m.language ?? undefined}
                  onDelete={() => run(async () => { await deleteLessonMedia(m.id); await onChanged(); })}
                />
              ))}
            </ul>
          )}

          {/*
            * The SAME notice the bulk drop uses, not a second design.
            *
            * These three states had their own inline markup here - a hand-built
            * bar, then two bare <p>s with hex colours - while the drop zone
            * three hundred lines down said the same things in a card. Two
            * vocabularies for one event, on one page.
            */}
          <div className="mt-2.5 flex flex-col gap-2">
            {uploadPercent !== null && (
              <UploadNotice
                tone="busy"
                icon={<Loader2 size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />}
                title={t("noticeUploading", { index: 1, total: 1 })}
                percent={Math.round(uploadPercent)}
                trailing={t("percentOnly", { percent: Math.round(uploadPercent) })}
              />
            )}
            {uploadError && (
              <UploadNotice
                tone="problem"
                icon={<AlertCircle size={16} strokeWidth={1.9} />}
                title={t("noticeFailedTitle", { count: 1 })}
                body={uploadError}
              />
            )}
            {uploadWarning && (
              <UploadNotice
                tone="caution"
                icon={<Gauge size={16} strokeWidth={1.9} />}
                title={t("noticeHeavyTitle", { count: 1 })}
                body={uploadWarning}
              />
            )}
          </div>

          {/* ── The two secondary actions ────────────────────────────── */}
          <div className="mt-2.5 flex items-center gap-1">
            <input
              ref={videoRef}
              type="file"
              /*
               * The types the SERVER takes. It refuses anything else because
               * those are what a browser plays without a transcode step, so
               * filtering here turns a refusal you hit after a 2GB upload into
               * one you cannot reach.
               */
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so the same file can be chosen twice, which a retry
                // after a failed upload depends on.
                e.target.value = "";
                if (file) void onFile(file, "VIDEO");
              }}
            />
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFile(file, "ATTACHMENT");
              }}
            />
            <input
              ref={captionRef}
              type="file"
              accept=".vtt,text/vtt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onCaption(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[var(--button-radius,0.5rem)] border-none bg-transparent px-2 py-1.5 text-[11.5px] font-medium text-zinc-600 cursor-pointer transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"
            >
              <Paperclip size={13} aria-hidden="true" />
              {t("addFile")}
            </button>
            <button
              type="button"
              onClick={() => captionRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[var(--button-radius,0.5rem)] border-none bg-transparent px-2 py-1.5 text-[11.5px] font-medium text-zinc-600 cursor-pointer transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"
            >
              <Captions size={13} aria-hidden="true" />
              {t("addCaptions")}
            </button>
            {/*
              * Linking, for a lesson that already exists.
              *
              * The server has always had the route; nothing called it, so an
              * author who had made a lesson and wanted to point it at a video
              * they already had online could only start again from the module.
              */}
            <LinkVideoRow
              target={{ lessonId: lesson.id }}
              disabled={busy}
              onLinked={onChanged}
            />
          </div>
        </div>
          )}


          {/* Where the free preview ends is NOT set in here. It is a property
              of the course's running order rather than of one lesson - "the
              sample stops after this one" only means anything next to the
              lessons it stops before - so it is set from the row, on the
              outline, where the boundary line it draws is visible. */}

          {/* Position is NOT set here. Reordering is done on the outline, by
              dragging the row, which is where you can see what the new order
              looks like. A pair of Move buttons inside a dialog asked somebody
              to reorder a list they could not see. */}

          {/* Leave on the left, destroy on the right, which is the order every
              footer in the builder now uses. The destructive action is the one
              that should take a deliberate reach; putting it where the thumb
              rests on the way out is how somebody deletes a lesson they meant
              to close. */}
          <ModalFooter>
            <ModalButton onClick={() => setOpen(false)}>{t("close")}</ModalButton>
            <ModalButton
              tone="danger"
              disabled={busy}
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={askDelete}
            >
              {lesson.quizId ? t("removeQuiz") : t("removeLesson")}
            </ModalButton>
          </ModalFooter>
          </>
          )}
        </BuilderModal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={lesson.quizId ? t("removeQuizConfirmTitle") : t("removeLessonConfirmTitle")}
          body={lesson.quizId
            ? t("removeQuizConfirmBody", { title: lesson.title })
            : t("removeLessonConfirmBody", { title: lesson.title })}
          confirmLabel={lesson.quizId ? t("removeQuiz") : t("removeLesson")}
          cancelLabel={t("cancelDescription")}
          busy={busy}
          /* No, so put back whatever raising this took away. */
          onClose={() => {
            setConfirmDelete(false);
            if (reopenAfterConfirm) setOpen(true);
            setReopenAfterConfirm(false);
          }}
          onConfirm={() => run(async () => {
            setConfirmDelete(false);
            // Yes: the sheet stays shut, because the thing it was editing is
            // about to stop existing.
            setReopenAfterConfirm(false);
            setOpen(false);
            await deleteLesson(lesson.id);
            await onChanged();
          })}
        />
      )}
    </li>
  );
}

/**
 * Where the free preview ends, drawn across the outline.
 *
 * The same line appears in the public syllabus and in the player's rail, so an
 * author, a visitor and a learner are all looking at one idea: above it is
 * what anybody can watch, below it is what the course is.
 */
/**
 * The free preview, said out loud, above the list it applies to.
 *
 * ── Why a panel and not just the row control ───────────────────────────────
 *
 * The whole feature used to be a 26px eye on a lesson row, next to a delete.
 * Nothing on the page said the words "free preview" until after you had
 * pressed it, so the commonest outcome was a course published with nothing
 * open at all - which is the one setting that decides whether anybody can
 * judge the course before paying for it.
 *
 * So it gets a named panel with two states, and the unset one leads with what
 * it costs you to leave it alone.
 *
 * ── The shortcuts are the point ────────────────────────────────────────────
 *
 * "The first lesson" and "the first module" are what almost every course
 * wants, and both used to require finding the right row and reading an icon.
 * They are one press here, and pressing either draws the line, which is the
 * confirmation.
 *
 * ── Not gated on price, and that is not an oversight ───────────────────────
 *
 * A course is a product and a product has tiers, so "free" is a property of a
 * TIER, not of the course - a course can offer a free tier and a paid one at
 * once. And what locks a lesson is ENTITLEMENT, not price: `CourseLesson.locked`
 * is computed per viewer from whether they have acquired the course at all.
 * Somebody who has acquired nothing sees the preview and nothing else, however
 * the tiers are priced. So there is no "this course is free, skip this"
 * case to draw - the preview is the only lever there is for what a
 * non-acquirer can see, and a free TIER gives away the whole course rather
 * than part of it.
 */
function PreviewPanel({
  previews,
  minutes,
  lastFreeTitle,
  hasLessons,
  busy,
  onFirstLesson,
  onFirstSection,
  onRemove,
}: {
  previews: number;
  minutes: number;
  lastFreeTitle: string | null;
  hasLessons: boolean;
  busy: boolean;
  onFirstLesson: () => void;
  onFirstSection: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("learning.builder");
  const set = previews > 0;

  return (
    <div
      className="rounded-2xl px-4 py-3.5"
      /* Neutral in both states. A green panel said "well done" about a
         setting that is neither right nor wrong - some courses sell better
         with no preview at all - and it was the loudest thing in the editor. */
      style={set
        ? { background: "#f6f6f5", border: "1px solid rgba(128,128,128,0.24)" }
        : { background: "#fafaf9", border: "1px solid rgba(128,128,128,0.16)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
          style={{ background: "rgba(128,128,128,0.12)", color: "#71717a" }}
        >
          {set ? <Eye size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
        </span>
        <span className="text-[13.5px] font-bold">{t("previewPanelTitle")}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
          style={{ background: "rgba(128,128,128,0.12)", color: "#71717a" }}
        >
          {set ? t("previewPanelCount", { lessons: previews, runtime: runtimeLabel(t, minutes) }) : t("previewPanelNotSet")}
        </span>
      </div>

      {/*
        * Three sentences, because there are three situations and the wrong one
        * is worse than none. With a boundary: where it is. With lessons and no
        * boundary: what leaving it costs. With NO lessons - the state this step
        * opens in, and the one where the whole feature used to be invisible -
        * the sentence is about what to do next, because "nobody can watch
        * anything before buying" is not yet true of anything.
        */}
      <p className="m-0 mt-1.5 text-[12px] leading-relaxed opacity-65">
        {set && lastFreeTitle
          ? t("previewPanelSetBody", { title: lastFreeTitle })
          : hasLessons
            ? t("previewPanelUnsetBody")
            : t("previewEmptyHint")}
      </p>

      {/*
        * Nothing to offer until there is something to open. A course with no
        * lessons gets the sentence and no buttons, rather than two controls
        * that would both do nothing - the drop zone below says the same thing
        * in the place where it can be acted on.
        */}
      {hasLessons && (
        <div className="mt-3 flex flex-wrap gap-2">
          {set ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="rounded-[var(--button-radius,0.75rem)] border-none px-3 py-2 text-[12.5px] font-semibold cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "rgba(128,128,128,0.12)", color: "#52525b" }}
            >
              {t("removePreview")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onFirstLesson}
                disabled={busy}
                className="rounded-[var(--button-radius,0.75rem)] border-none px-3 py-2 text-[12.5px] font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-40"
                /* The community's brand, which is the one accent this page is
                   entitled to spend, rather than a green of our own. */
                style={{ background: "var(--primary-btn-bg, var(--brand-color))", color: "var(--primary-btn-text, var(--brand-contrast, #fff))" }}
              >
                {t("previewFirstLesson")}
              </button>
              <button
                type="button"
                onClick={onFirstSection}
                disabled={busy}
                className="rounded-[var(--button-radius,0.75rem)] border-none px-3 py-2 text-[12.5px] font-semibold cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgba(128,128,128,0.12)", color: "#52525b" }}
              >
                {t("previewFirstSection")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dragging the line that ends the free preview.
 *
 * ── Why this is NOT dnd-kit, which everything else here uses ───────────────
 *
 * The lessons are sortable items, and dnd-kit is the right tool for that: each
 * section owns a DndContext over its own rows. The boundary is not an item in
 * any of those lists. It is a POSITION in the course, it can sit in the middle
 * of module two, and it has to be draggable past the end of a module into the
 * next one - which a per-section context cannot express. Making it a sortable
 * would mean merging every section's context into one, changing how lesson
 * reordering works to add a control that is not a lesson.
 *
 * So it reads the pointer directly and asks the document what row is under it.
 * That is the whole mechanism: `elementFromPoint`, then the nearest ancestor
 * carrying a lesson id.
 *
 * ── It is a preview, not a commit ─────────────────────────────────────────
 *
 * While the pointer is down nothing is written. The line follows, and the rows
 * re-mark themselves free or locked as it passes them, so the thing being
 * decided is visible while it is being decided. The write happens once, on
 * release, and only if the answer changed.
 *
 * ── Dragging is never the only way ────────────────────────────────────────
 *
 * WCAG 2.5.7 asks for a single-pointer alternative to any dragging movement,
 * and a keyboard path does not satisfy it. Two exist and both predate this:
 * every row carries "End the free preview here", and the panel above offers
 * the first lesson and the first module in one press. The arrow keys below are
 * an extra, not the alternative.
 */
function usePreviewDrag({
  orderedIds,
  boundaryId,
  onCommit,
}: {
  /** Every lesson in the course, in the order a learner meets them. */
  orderedIds: string[];
  boundaryId: string | null;
  onCommit: (lastFreeLessonId: string | null) => void;
}) {
  /*
   * `undefined` means no drag in progress, which is NOT the same as `null`.
   * Null is a real destination - dragged above the first lesson, meaning no
   * free preview at all - and a single nullable would collapse "not dragging"
   * into "about to remove it".
   */
  const [dragTo, setDragTo] = useState<string | null | undefined>(undefined);
  const dragging = dragTo !== undefined;
  const effectiveId = dragging ? dragTo : boundaryId;

  /*
   * How far down the course a lesson sits, quizzes included. A quiz can sit
   * INSIDE the free range even though it can never end it, so it has to count
   * when deciding which side of the line a row is on.
   */
  const rank = useCallback(
    (id: string | null) => (id === null ? -1 : orderedIds.indexOf(id)),
    [orderedIds],
  );
  const isFree = useCallback(
    (id: string) => rank(id) <= rank(effectiveId ?? null) && rank(id) !== -1,
    [rank, effectiveId],
  );

  const resolve = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest?.("[data-preview-target]") as HTMLElement | null;
    if (!row) return undefined;
    const id = row.dataset.previewTarget;
    if (!id) return undefined;
    /*
     * The top half of the first lesson means "above everything", which is the
     * only way to reach "no free preview" by dragging. Anywhere else, the row
     * you are over is the last free one - the line lands UNDER the row, which
     * is where it is drawn.
     */
    if (id === orderedIds[0]) {
      const box = row.getBoundingClientRect();
      if (clientY < box.top + box.height / 2) return null;
    }
    return id;
  }, [orderedIds]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragTo(boundaryId);
  }, [boundaryId]);

  /*
   * The move and release listeners go on the WINDOW, not on the handle, and
   * that is not tidiness - the handle cannot keep them.
   *
   * The line is rendered after whichever lesson is currently the boundary, so
   * the moment the drag moves it, React unmounts the button from under one row
   * and mounts a new one under another. Anything bound to that element - its
   * own pointermove, its pointerup, even a pointer capture - goes with it, and
   * the drag ends up with no way to finish: the rows keep following the
   * pointer and the release is never heard. Found by driving a real pointer;
   * jsdom cannot show it, because nothing there moves.
   *
   * A ref carries the live destination so these listeners are bound once per
   * drag rather than re-bound on every frame of it.
   */
  const dragToRef = useRef<string | null | undefined>(undefined);
  dragToRef.current = dragTo;

  const finish = useCallback((commit: boolean) => {
    const current = dragToRef.current;
    dragToRef.current = undefined;
    setDragTo(undefined);
    if (current !== undefined && commit && current !== boundaryId) onCommit(current);
  }, [boundaryId, onCommit]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const next = resolve(e.clientX, e.clientY);
      // `undefined` means the pointer left the list, which is not a
      // destination - hold the last one rather than snapping to null.
      if (next !== undefined) setDragTo(next);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging, resolve, finish]);

  /*
   * Escape cancels, which is the other half of "nothing is written until you
   * let go": a drag you did not mean has a way out that is not "put it back
   * where you found it".
   */
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, finish]);

  /** Arrow keys step the boundary one lesson, and commit immediately. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = rank(boundaryId) + step;
    if (next >= orderedIds.length) return;
    onCommit(next < 0 ? null : orderedIds[next]);
  }, [rank, boundaryId, orderedIds, onCommit]);

  return {
    dragging,
    effectiveId,
    isFree,
    handleProps: { onPointerDown, onKeyDown },
  };
}

function PreviewBoundaryLine({
  dragging,
  handleProps,
}: {
  dragging: boolean;
  handleProps: Record<string, unknown>;
}) {
  const t = useTranslations("learning.builder");
  return (
    <li className="list-none px-1.5 py-1" aria-hidden="false">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1" style={{ background: "rgba(128,128,128,0.28)" }} />
        {/*
          * The label IS the handle. A separate grip beside it would be a
          * second thing to find on a control whose whole job is to be obvious,
          * and the pill is already the only part of this line big enough to
          * grab. `touch-none` is load-bearing: without it the browser claims
          * the gesture for scrolling and the drag never starts on a phone.
          */}
        <button
          type="button"
          {...handleProps}
          aria-label={t("previewDragHandle")}
          title={t("previewDragHandle")}
          className={`inline-flex shrink-0 touch-none items-center gap-1.5 rounded-[var(--button-radius,9999px)] border-none px-2.5 py-1 text-[11px] font-semibold transition-shadow ${
            dragging ? "cursor-grabbing shadow-[0_4px_12px_-4px_rgba(60,40,30,0.45)]" : "cursor-grab"
          }`}
          /* Neutral, like the rail and the chips it belongs to. The whole
             free-preview vocabulary used one green; the line that ENDS the
             preview was the loudest piece of it, and it marks a boundary
             rather than a success. */
          style={{ background: "rgba(128,128,128,0.12)", color: "#52525b" }}
        >
          <GripVertical size={11} aria-hidden="true" />
          {t("previewEndsLine")}
        </button>
        <span className="h-px flex-1" style={{ background: "rgba(128,128,128,0.28)" }} />
      </div>
    </li>
  );
}

/**
 * One module, pickable by its header.
 *
 * ── Why this exists, against the note that used to sit here ────────────────
 *
 * Sections deliberately did NOT drag. The reasoning, which was sound: a
 * section is a whole card — header, description, every lesson in it, footer —
 * so picking one up means picking up a block taller than the viewport. The
 * gesture fights the page's own scroll and there is nowhere on screen to see
 * where it will land.
 *
 * That objection is about the SIZE of the thing being dragged, not about
 * dragging, so the fix is to make it small: while a module is in the air it
 * collapses to its header, and what moves under the cursor is a single row the
 * height of one line. The arrows stay for anyone who prefers them, and for a
 * keyboard, where "one place at a time, always lands where it says" is still
 * the better interaction.
 *
 * Asked for after a course reached fifteen modules, where moving one to the
 * top is fourteen presses.
 */
function SortableSection({
    id,
    children,
}: {
    id: string;
    /** Rendered with the handle's props, so the grip sits in the header. */
    children: (bag: {
        handleProps: Record<string, unknown>;
        dragging: boolean;
    }) => React.ReactNode;
}) {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });

    return (
        <div
            ref={setNodeRef}
            className="group/section overflow-hidden rounded-2xl bg-zinc-50"
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                /* Above its siblings while it moves, or the card it passes over
                   is drawn on top of it and the drag looks like it stopped. */
                zIndex: isDragging ? 30 : undefined,
                position: "relative",
                boxShadow: isDragging ? "0 12px 32px -12px rgba(60,40,30,0.45)" : undefined,
            }}
        >
            {children({ handleProps: { ...attributes, ...listeners }, dragging: isDragging })}
        </div>
    );
}

function MoveButtons({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const t = useTranslations("learning.builder");
  /*
   * A filled 26px tile each, not a bare 14px glyph.
   *
   * These were two hairline chevrons at 50% opacity on a grey card, so the one
   * pair of controls that does the thing this page exists for - putting the
   * lessons in the right order - was the faintest thing on it, and on a touch
   * screen the target was half what a thumb needs. The muted fill is the same
   * one every secondary control in the app wears, so they read as buttons
   * without competing with the lesson titles.
   */
  const tile =
    "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-none cursor-pointer transition-colors hover:brightness-95 disabled:opacity-30 disabled:cursor-default";
  const style = { background: "rgba(128,128,128,0.12)", color: "var(--text-color)" };
  return (
    <>
      <button
        type="button"
        onClick={() => onMove(index - 1)}
        disabled={index === 0}
        aria-label={t("moveUp")}
        className={tile}
        style={style}
      >
        <ChevronUp size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onMove(index + 1)}
        disabled={index === count - 1}
        aria-label={t("moveDown")}
        className={tile}
        style={style}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </>
  );
}

export function CourseBuilder({
  productId,
  communityTag,
  initialSections,
  onPlayableChange,
}: {
  productId: string;
  communityTag: string;
  initialSections: CourseSection[];
  /**
   * Fires with whether this course has anything to WATCH yet.
   *
   * The wizard gates its Next on it, and the builder is the only thing that
   * knows: it re-reads the whole syllabus after every write, so the wizard
   * would otherwise have to poll the same endpoint to learn what the builder
   * already has in state.
   */
  onPlayableChange?: (hasPlayableLesson: boolean) => void;
}) {
  const t = useTranslations("learning.builder");
  const [sections, setSections] = useState(initialSections);
  const { busy, run } = useBusy();

  /*
   * One re-read for the whole page after any write. Deliberately not a
   * per-branch refresh: the server owns `order` across every sibling, so a
   * write that moves one lesson changes numbers on lessons the caller never
   * touched.
   */
  const refresh = useCallback(async () => {
    setSections(await getCourseContentClient(communityTag, productId));
  }, [communityTag, productId]);

  /**
   * Have we heard from the server yet?
   *
   * ── Why an empty list is not enough to act on ─────────────────────────────
   *
   * `sections` starts empty for every mount, including a draft that already
   * has six modules in it: the wizard seeds it that way on purpose and lets
   * the first read converge. So "sections.length === 0" answers TWO different
   * questions at once - "this course has no modules" and "we have not asked
   * yet" - and the empty state cannot tell them apart.
   *
   * That conflation shipped as a real bug. Reopening a draft showed the
   * "first module" placeholder over a course that already had one, and the
   * placeholder's controls all begin by WRITING a module (materialiseFirstSection).
   * Pressing "Add a quiz" on what looked like module 1 therefore created a
   * module 2 and put the quiz in that, leaving the author with an empty module
   * they never asked for and a quiz somewhere they did not put it.
   *
   * Gating on this instead means an unanswered read renders nothing rather
   * than rendering a lie somebody can click.
   */
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  /**
   * The first read, on mount.
   *
   * This did not exist: the builder only ever re-read AFTER a write, so a
   * resumed draft stayed blank until the author changed something - and the
   * first thing they changed was usually the phantom module above. The wizard
   * mounts this with `initialSections={[]}` and a comment promising exactly
   * this fetch, which is the half that was missing.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const fetched = await getCourseContentClient(communityTag, productId);
        if (alive) { setSections(fetched); setLoaded(true); }
      } catch {
        /*
         * Deliberately NOT `setLoaded(true)` in a finally. A failed read knows
         * nothing about what the course holds, and the empty state is the one
         * branch here whose buttons create rows. Better a page that says it
         * could not load than one that invites somebody to rebuild an outline
         * that is already there.
         */
        if (alive) setLoadError(true);
      }
    })();
    return () => { alive = false; };
  }, [communityTag, productId]);

  const bulk = useBulkUpload(refresh);

  /*
   * ── What counts as a syllabus ──────────────────────────────────────────
   *
   * One lesson with a video in it. Not "a section exists", not "a quiz
   * exists".
   *
   * A quiz tests what the lessons taught, so a course that is ONLY a quiz
   * tests nothing it delivered - somebody who buys a course and receives a
   * quiz has been mis-sold, and that is a refund rather than an edge case. A
   * lesson with no video is not a lesson either: a lesson IS a video, and an
   * empty one is a placeholder the author still has to come back to.
   *
   * So the rule a seller can act on is one sentence: a course needs something
   * to watch.
   */
  const hasPlayableLesson = useMemo(
    () => sections.some((section) =>
      section.lessons.some((lesson) =>
        !lesson.quizId && lesson.media.some((m) => m.kind === "VIDEO"),
      ),
    ),
    [sections],
  );

  useEffect(() => {
    onPlayableChange?.(hasPlayableLesson);
  }, [hasPlayableLesson, onPlayableChange]);

  /*
   * The last free lesson in the whole course, in the order a learner meets
   * them. Computed here rather than per section, because the boundary is one
   * fact about the COURSE - it can fall in the middle of section two, and
   * section three then has nothing free in it at all.
   */
  const lastFreeLessonId = useMemo(() => {
    let last: string | null = null;
    for (const section of sections) {
      for (const lesson of section.lessons) {
        if (!lesson.isPreview) return last;
        last = lesson.id;
      }
    }
    return last;
  }, [sections]);

  /*
   * What the panel needs to offer its two shortcuts, in the order a learner
   * meets things. Quizzes are skipped for both: a quiz cannot END the preview,
   * so "the first lesson" and "the last lesson of module one" have to mean the
   * first and last WATCHABLE things, or pressing either would move the
   * boundary somewhere the server will not put it.
   */
  const previewTargets = useMemo(() => {
    let firstLessonId: string | null = null;
    let firstSectionLastLessonId: string | null = null;
    let lastFreeTitle: string | null = null;
    for (const [index, section] of sections.entries()) {
      for (const lesson of section.lessons) {
        if (lesson.id === lastFreeLessonId) lastFreeTitle = lesson.title;
        if (lesson.quizId) continue;
        if (!firstLessonId) firstLessonId = lesson.id;
        if (index === 0) firstSectionLastLessonId = lesson.id;
      }
    }
    return { firstLessonId, firstSectionLastLessonId, lastFreeTitle };
  }, [sections, lastFreeLessonId]);

  /*
   * Every lesson in the course, flat, in the order a learner meets them.
   * Quizzes included: one can sit inside the free range, so it counts when
   * deciding which side of the line a row falls on, even though it can never
   * be the row the line sits under.
   */
  const orderedLessonIds = useMemo(
    () => sections.flatMap((section) => section.lessons.map((l) => l.id)),
    [sections],
  );


  /** Files somebody dropped that were not videos, named so they can be moved. */
  const [rejected, setRejected] = useState<string[]>([]);

  const applyBoundary = (lastFreeId: string | null) => run(async () => {
    await setPreviewBoundary(productId, lastFreeId);
    await refresh();
  });

  const previewDrag = usePreviewDrag({
    orderedIds: orderedLessonIds,
    boundaryId: lastFreeLessonId,
    onCommit: applyBoundary,
  });

  /*
   * What the author is actually watching while they build.
   *
   * Lesson count and runtime, because "is this a real course yet" is the
   * question a half-built syllabus raises and neither number is readable off a
   * list of rows. Preview count because a course with none is asking to be
   * bought sight unseen, which is the thing `isPreview` exists to prevent and
   * nothing else on this page would mention.
   *
   * Runtime only counts media that reported a duration. A video whose duration
   * the uploader did not send contributes nothing rather than a zero that reads
   * as an empty lesson.
   */
  const summary = useMemo(() => {
    let lessons = 0;
    let seconds = 0;
    let previews = 0;
    /*
     * The free part's runtime, counted separately from the course's.
     *
     * The panel reads "2 lessons · 20 min", and a reader takes both halves as
     * describing the same thing. Handed the whole course's runtime it would
     * promise twenty free minutes of an eleven-minute preview - a number that
     * is wrong in the direction that gets noticed only by the buyer.
     */
    let previewSeconds = 0;
    let quizzes = 0;
    for (const section of sections) {
      for (const lesson of section.lessons) {
        /*
         * A quiz is counted as a quiz, not as a lesson. "12 lessons" that
         * turns out to include four quizzes overstates the watching and
         * understates what the course actually asks of somebody.
         */
        if (lesson.quizId) { quizzes++; continue; }
        lessons++;
        if (lesson.isPreview) previews++;
        for (const m of lesson.media) {
          seconds += m.durationSeconds ?? 0;
          if (lesson.isPreview) previewSeconds += m.durationSeconds ?? 0;
        }
      }
    }
    return {
      lessons,
      minutes: Math.round(seconds / 60),
      previews,
      previewMinutes: Math.round(previewSeconds / 60),
      quizzes,
    };
  }, [sections]);

  /**
   * Drop onto the empty state, with nowhere to put the lessons yet.
   *
   * Creates the section first, then fills it. Named from the copy rather than
   * left untitled: a section called "" renders as a blank heading above real
   * lessons, which looks like the page failed rather than like a default.
   */
  const dropIntoNewSection = (files: File[]) => run(async () => {
    const section = await createSection(productId, { title: t("newSection") });
    await refresh();
    await bulk.upload(section.id, files);
  });

  /**
   * Turn the placeholder first section into a real one.
   *
   * Called by whichever of its controls the author touches first, and only
   * then. The step used to open on a bare drop zone, so the structure it was
   * asking somebody to build - a course holds sections, a section holds
   * lessons - appeared only AFTER the first drop, which had silently created
   * a section nothing on screen had mentioned. Meanwhile "Add section" sat
   * underneath reading like a step you were skipping.
   *
   * Showing a first section instead makes the model visible from the first
   * second. Not WRITING it until it is used is the other half: a course
   * somebody opens and abandons should not leave an empty section behind, and
   * a draft is a real products row, so a phantom child row is a real one too.
   */
  /**
   * The section whose delete is waiting on an answer, by id.
   *
   * Held by ID rather than as a boolean per card: one dialog for the whole
   * list, so six sections do not mount six confirmations that are each closed
   * 99.9% of the time.
   */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /*
   * An 8px threshold before a press becomes a drag, so a tap that wanders a
   * pixel still opens the lesson. TouchSensor gets a 200ms hold instead: on a
   * phone the same gesture that starts a drag also scrolls the page, and
   * distance alone cannot tell them apart - time can.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Reorder within one section, from a drop. */
  /**
   * A module dropped somewhere else in the outline.
   *
   * Writes through the same `reorderSections` the chevrons use, so the two
   * gestures cannot drift into two different orders — and so the server
   * sees one operation it already understands.
   */
  const onSectionDragEnd = (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = sections.findIndex((s) => s.id === active.id);
      const to = sections.findIndex((s) => s.id === over.id);
      if (from < 0 || to < 0) return;
      void run(async () => {
          await reorderSections(productId, move(sections, from, to).map((s) => s.id));
          await refresh();
      });
  };

  const onLessonDragEnd = (sectionId: string, ids: string[]) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void run(async () => {
      await reorderLessons(sectionId, move(ids, from, to));
      await refresh();
    });
  };

  const materialiseFirstSection = async (title?: string) => {
    const section = await createSection(productId, { title: title?.trim() || t("newSection") });
    await refresh();
    return section.id;
  };

  return (
    <div className="flex flex-col gap-8">
      {/* A live region: the bulk upload's progress is the one thing on this
          page that changes without anybody pressing anything. */}
      <div aria-live="polite" className="sr-only">
        {bulk.progress
          ? t("bulkProgress", {
              index: bulk.progress.index,
              total: bulk.progress.total,
              name: bulk.progress.fileName,
            percent: Math.round(bulk.progress.percent ?? 0),
            })
          : ""}
      </div>

      {/* Nothing to say yet, and nothing to press. A skeleton in the shape of a
          module card, so the step does not jump from blank to a full outline -
          and, more to the point, so there is no button here to create a module
          the course may already have. */}
      {!loaded && !loadError && (
        <div
          aria-hidden="true"
          className="h-[168px] rounded-2xl bg-zinc-50 animate-pulse motion-reduce:animate-none"
        />
      )}

      {loadError && (
        <p className="text-[13px] m-0" style={{ color: "#b91c1c" }}>
          {t("loadFailed")}
        </p>
      )}

      {sections.length > 0 && (
        /*
         * Four figures, each over its own label.
         *
         * It was one grey run-on sentence - "4 lessons - 0 min - 0 free
         * preview - 2 quizzes" - set at the same weight and colour as a hint,
         * where the numbers are the whole point and none of them stood out
         * from the words around them. You cannot scan a sentence for a
         * number; you can scan a row of numbers.
         *
         * A zero is dimmed rather than hidden. "0 free preview" is a real and
         * actionable state - nobody can watch anything before buying - and a
         * strip whose columns come and go is one you have to re-read.
         */
        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-zinc-100 sm:grid-cols-4">
          {[
            { key: "lessons", value: summary.lessons, label: t("statLessons") },
            { key: "minutes", value: runtimeLabel(t, summary.minutes), zero: summary.minutes === 0, label: t("statRuntime") },
            { key: "previews", value: summary.previews, label: t("statFreePreviews") },
            { key: "quizzes", value: summary.quizzes, label: t("statQuizzes") },
          ].map((stat) => (
            <div key={stat.key} className="bg-white px-3.5 py-2.5">
              <dt className="m-0 text-[11px] font-medium opacity-50">{stat.label}</dt>
              <dd
                className="m-0 mt-0.5 text-[17px] font-bold leading-none tabular-nums"
                style={{
                  fontFamily: "var(--heading-font)",
                  opacity: (stat.zero ?? stat.value === 0) ? 0.35 : 1,
                }}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/*
        * The free preview, named and in the open, above the list it applies
        * to. See PreviewPanel for why it is not an icon on a row any more.
        *
        * Under the stats strip rather than above it, because the strip answers
        * "is this a real course yet" and this answers "can anyone tell before
        * they pay" - the second question only matters once the first has an
        * answer.
        */}
      {loaded && sections.length > 0 && (
        <PreviewPanel
          previews={summary.previews}
          minutes={summary.previewMinutes}
          lastFreeTitle={previewTargets.lastFreeTitle}
          hasLessons={summary.lessons > 0}
          busy={busy}
          onFirstLesson={() => {
            if (previewTargets.firstLessonId) applyBoundary(previewTargets.firstLessonId);
          }}
          onFirstSection={() => {
            if (previewTargets.firstSectionLastLessonId) {
              applyBoundary(previewTargets.firstSectionLastLessonId);
            }
          }}
          onRemove={() => applyBoundary(null)}
        />
      )}

      {loaded && sections.length === 0 && (
        /*
         * The empty state is a SECTION, not a bare drop zone.
         *
         * Same card, same controls and same order as a real one, so the first
         * thing an author sees is the shape of the thing they are building.
         * Every control on it writes the section first (materialiseFirstSection)
         * and then does what was asked, so nothing is stored for a course
         * somebody opens and walks away from.
         */
        <div className="group/section rounded-2xl bg-zinc-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100">
            <span className="shrink-0 text-[13px] font-bold tabular-nums opacity-35">1</span>
            <InlineText
              value=""
              placeholder={t("firstSectionPlaceholder")}
              onCommit={(title) => title && run(async () => { await materialiseFirstSection(title); })}
              /* Same field as a real module's title below, because this card
                 exists to be the shape of a real one. It matters more here if
                 anything: this is the first thing an author sees, and it is
                 the only thing on the card that asks them to type. */
              className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-[14.5px] font-semibold ring-1 ring-zinc-200 transition-shadow hover:ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            <span className="hidden shrink-0 text-[11.5px] opacity-45 sm:inline">{t("lessonCount", { count: 0 })}</span>
          </div>

          {/*
            * A description, before there is anything to describe.
            *
            * Writing "what this module covers" is often the FIRST thing
            * somebody does - it is the plan, and the lessons are what fills
            * it. Making it wait for a video would mean the outline cannot be
            * sketched in the order people actually think.
            */}
          <div className="px-1.5 pt-1.5">
            <DescriptionField
              value={null}
              disabled={busy}
              addLabel={t("addSectionDescription")}
              placeholder={t("sectionDescriptionPlaceholder")}
              modalTitle={t("sectionDescriptionTitle")}
              onSave={(description) => run(async () => {
                const sectionId = await materialiseFirstSection();
                if (description) await updateSection(sectionId, { description });
                await refresh();
              })}
            />
          </div>

          {/* The same row a module with lessons in it shows, so the layout does
              not rearrange itself the moment the first one lands. The drop zone
              keeps its full height here, because on an empty course it is the
              fastest way to build one. */}
          <div className="flex flex-col gap-2 p-1.5 sm:flex-row">
            <div className="flex-1">
              {/* Both sources, on a course that has nothing in it yet. The
                  section is made at the moment one of them is answered, not
                  before: an author who opens the dialog and closes it again
                  should not be left with an empty module they did not ask
                  for. */}
              <AddLessonCard
                target={async () => ({ sectionId: await materialiseFirstSection() })}
                onFiles={dropIntoNewSection}
                onRejected={setRejected}
                onAdded={refresh}
                disabled={busy || !!bulk.progress}
              />
            </div>
            <AddCard
              compact
              title={t("addQuiz")}
              hint={t("addQuizHint")}
              disabled={busy}
              busy={busy}
              onClick={() => run(async () => {
                const sectionId = await materialiseFirstSection();
                const created = await createLesson(sectionId, { title: t("newQuiz") });
                await createQuiz(created.id, {});
                await refresh();
              })}
            />
          </div>
        </div>
      )}

      {bulk.progress && (
        /* The filename is the BODY, not part of the headline: "Uploading 2 of 3"
           is the status and the name is which one, and running them together
           made a line that reflowed every time the file changed. */
        <UploadNotice
          tone="busy"
          icon={<Loader2 size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />}
          title={t("noticeUploading", { index: bulk.progress.index, total: bulk.progress.total })}
          body={bulk.progress.fileName}
          percent={Math.round(bulk.progress.percent ?? 0)}
          trailing={t("percentOnly", { percent: Math.round(bulk.progress.percent ?? 0) })}
        />
      )}

      {rejected.length > 0 && (
        /* Named, and it says where the file DOES belong - a worksheet is not a
           lesson, it is something that hangs off one. */
        <UploadNotice
          tone="caution"
          icon={<FileX2 size={16} strokeWidth={1.9} />}
          title={t("noticeNotVideoTitle", { count: rejected.length })}
          body={t("noticeNotVideoBody")}
          files={rejected}
        />
      )}

      {bulk.failed.length > 0 && (
        /* Named, not counted: the filenames are what somebody needs in order to
           drag the right ones back in. */
        <UploadNotice
          tone="problem"
          icon={<AlertCircle size={16} strokeWidth={1.9} />}
          title={t("noticeFailedTitle", { count: bulk.failed.length })}
          /*
           * ── The sentence that was missing ──────────────────────────────
           *
           * "Drop them in again to retry" used to be the ONLY thing this said,
           * and for the failure sellers actually hit it was advice that could
           * not work: the file was refused for being too large, so every retry
           * failed identically. The upload layer builds a real message and the
           * bulk handler used to discard it with a bare catch.
           *
           * So the reason leads when there is one, and the generic retry line
           * is the fallback rather than the headline.
           */
          body={bulk.error ?? t("noticeFailedRetry")}
          files={bulk.failed}
        />
      )}

      {bulk.warning && (
        /*
          * A NUDGE, not a refusal. We do not transcode, so whatever is uploaded
          * is what every learner streams on every device - but a big file is a
          * judgement call about the author's own material, not an error, and
          * blocking them over it would be the wrong trade. Said once, where
          * they can still act on it.
          */
        <UploadNotice
          tone="caution"
          icon={<Gauge size={16} strokeWidth={1.9} />}
          title={t("noticeHeavyTitle", { count: bulk.warning.split(", ").length })}
          body={t("noticeHeavyBody")}
          files={bulk.warning.split(", ")}
        />
      )}

      {/*
        * The module list's own DndContext, OUTSIDE the per-section ones that
        * reorder lessons. Nesting is what keeps the two gestures apart: a
        * lesson drag is claimed by the inner context and never reaches this
        * one, and a module drag can only start from the grip in its header.
        */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        /* Vertical only, and never outside the outline — the same rule the
           lesson lists follow, for the same reason: a card that can be dragged
           off the page while the drop target stays put looks broken at exactly
           the moment it is working. */
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onSectionDragEnd}
      >
      <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
      {sections.map((section, sIndex) => (
        /*
          * One card per section, in the form's own list language: a flat
          * zinc-50 fill with hairline dividers, no border and no shadow at
          * rest. The lift is on the ROWS, on hover, because the row is the
          * thing you act on and the card is only the thing that holds them.
          */
        /*
          * A section reorders by dragging its grip OR with the chevrons.
          * See SortableSection for why dragging a whole card is safe now.
          */
        <SortableSection key={section.id} id={section.id}>
        {({ handleProps, dragging }) => (
        <>
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100">
            {/*
              * The grip, and ONLY the grip. The header also holds the title
              * field: a header that dragged anywhere would make renaming a
              * module a gamble on whether the press was read as a drag.
              */}
            <button
              type="button"
              {...handleProps}
              aria-label={t("dragSection")}
              title={t("dragSection")}
              className="-ml-1 flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md border-none bg-transparent text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="shrink-0 text-[13px] font-bold tabular-nums opacity-35">{sIndex + 1}</span>
            <InlineText
              value={section.title}
              placeholder={t("sectionTitle")}
              onCommit={(title) => title && run(async () => {
                await updateSection(section.id, { title });
                await refresh();
              })}
              /*
               * It looks like a field WITHOUT being touched or hovered.
               *
               * Two goes at this. It began as 13.5px borderless text that
               * happened to be an input, so a module title read as a heading
               * and nobody tried to click it. Making it bigger and adding a
               * hover tint fixed the size but not the substance: a hover state
               * is not an affordance on a touch screen, where there is no
               * hover, and on a desktop it still asked somebody to discover by
               * accident that a heading was typeable.
               *
               * So it wears a fill and a hairline at REST - the same treatment
               * the lesson title field inside the dialog has, so the one
               * control that renames something looks the same wherever it
               * appears. Against the module header's zinc-50 the white box is
               * what separates "the name of this module" from "a label for
               * this module".
               */
              className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-[14.5px] font-semibold ring-1 ring-zinc-200 transition-shadow hover:ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            {/* What the section holds, so a glance down the page answers "which
                chapter is still empty".

                Hidden on a phone: a 15px bold title, this count and two reorder
                tiles do not fit across 375px, and of the three this is the one
                the list underneath already answers. */}
            <span className="hidden shrink-0 text-[11.5px] opacity-45 tabular-nums sm:inline">
              {t("lessonCount", { count: section.lessons.filter((l) => !l.quizId).length })}
            </span>
            {/* Reorder only. Deleting the section moved to the footer, with
                the other things you can do to a section - a bin tucked between
                the title and the lesson count was a destructive action sitting
                in the middle of the row you click to rename. */}
            <div className="flex items-center gap-1 shrink-0">
              <MoveButtons
                index={sIndex}
                count={sections.length}
                onMove={(to) => run(async () => {
                  await reorderSections(productId, move(sections, sIndex, to).map((s) => s.id));
                  await refresh();
                })}
              />
            </div>
          </div>

          {/*
            * COLLAPSED while it is in the air, and this is what makes dragging
            * a module workable at all. A section is a whole card — description,
            * every lesson, footer — so carrying one means carrying a block
            * taller than the viewport, with nowhere on screen to see where it
            * would land. Hidden during the drag, what moves under the cursor is
            * the header alone: one row, the height of a line, with the list it
            * is moving through visible around it.
            */}
          {!dragging && (
          <>
          {/* Under the title, above the lessons: a chapter's blurb introduces
              what follows it, and this is the only place on the page where
              that reading order is also the editing order. */}
          <div className="px-1.5 pt-1.5">
            <DescriptionField
              value={section.description}
              disabled={busy}
              addLabel={t("addSectionDescription")}
              placeholder={t("sectionDescriptionPlaceholder")}
              modalTitle={t("sectionDescriptionTitle")}
              onSave={(description) => run(async () => {
                await updateSection(section.id, { description });
                await refresh();
              })}
            />
          </div>

          {/*
            * Where the module's own settings stop and its contents begin.
            *
            * "Describe this module" and a lesson row were the same shape in
            * the same stack, so the card read as one undifferentiated list in
            * which the first item happened to be a text field. The caption
            * costs one line and says which of the two things below the title
            * you are looking at - the same job the "Questions" caption does
            * inside a quiz, so the two levels of the builder label themselves
            * the same way.
            *
            * It is here whether or not the module has anything in it yet: the
            * add-cards underneath are contents too, and an empty module is
            * exactly the case where somebody needs telling what goes there.
            */}
          <p className="m-0 px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            {t("contentsLabel")}
          </p>

          {/* One DndContext per section, so a lesson can only be dropped among
              its own siblings. Dragging a lesson INTO another section is a
              different operation - it needs a new parent, not a new index -
              and offering it here would promise a write the API does not
              have. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            /*
             * The list reorders vertically, so the drag moves vertically.
             * Without this the row follows the pointer sideways as well and
             * can be dragged clean out of the card it belongs to, while the
             * drop target never changes - the gesture looks broken at exactly
             * the moment it is working. `restrictToParentElement` keeps it
             * inside its own section for the same reason: a lesson cannot be
             * dropped into another section, so it should not appear to go
             * there.
             */
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onLessonDragEnd(section.id, section.lessons.map((l) => l.id))}
          >
            <SortableContext
              items={section.lessons.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="list-none m-0 p-1.5 flex flex-col gap-1.5">
                {section.lessons.map((lesson, lIndex) => (
                  <Fragment key={lesson.id}>
                  <LessonRow
                    lesson={lesson}
                    sectionId={section.id}
                    siblingIds={section.lessons.map((l) => l.id)}
                    index={lIndex}
                    count={section.lessons.length}
                    onChanged={refresh}
                    selectTitleOnMount={lesson.id === bulk.firstCreatedId}
                    isLastFree={lesson.id === previewDrag.effectiveId}
                    /*
                     * Free-ness comes from the DRAG, not from the row's saved
                     * `isPreview`, so the rows re-mark themselves as the line
                     * passes them and the thing being decided is visible while
                     * it is being decided. With no drag in progress the two are
                     * the same answer.
                     */
                    isFree={previewDrag.isFree(lesson.id)}
                    onSetBoundary={applyBoundary}
                  />
                  {lesson.id === previewDrag.effectiveId && (
                    <PreviewBoundaryLine
                      dragging={previewDrag.dragging}
                      handleProps={previewDrag.handleProps}
                    />
                  )}
                  </Fragment>
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {/*
            * Two controls, because a section holds two kinds of thing.
            *
            * There used to be three: "Add lesson", "Add a quiz" and "Drop
            * videos into this section" - and the first and third made the same
            * object. A lesson IS a video: that is what distinguishes it from a
            * quiz, and an empty lesson with no video is not a step in a course,
            * it is a placeholder somebody has to come back to. So the lesson
            * control is the drop zone: drop files on it, or click it to choose
            * them, and each file becomes a lesson.
            *
            * Attachments are deliberately NOT here. An attachment is something
            * that hangs off a lesson - the worksheet for this video - not a
            * step somebody "watches" by pressing download. It is added inside
            * a lesson, next to that lesson's video.
            */}
          {/* The two things a module can hold, side by side and equally wide -
              and the SAME row an empty module shows, so the layout does not
              rearrange itself the moment the first lesson lands. */}
          <div className="flex flex-col gap-2 px-1.5 pb-1.5 sm:flex-row">
            <div className="flex-1">
            <AddLessonCard
              target={{ sectionId: section.id }}
              onFiles={(files) => void bulk.upload(section.id, files)}
              onRejected={setRejected}
              onAdded={refresh}
              disabled={busy || !!bulk.progress}
            />
            </div>
            <AddCard
              compact
              title={t("addQuiz")}
              hint={t("addQuizHint")}
              disabled={busy}
              busy={busy}
              onClick={() => run(async () => {
                const created = await createLesson(section.id, { title: t("newQuiz") });
                await createQuiz(created.id, {});
                await refresh();
              })}
            />
          </div>

          {/* The destructive one, last and on its own, after everything you
              might have come to the footer to do. */}
          <div className="px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => setConfirmDelete(section.id)}
              disabled={busy}
              /* A fill at rest, not only under the pointer. On a touch screen
                 a hover-only background never appears at all, so the control
                 read as red text somebody had left in the footer. */
              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--button-radius,1rem)] border-none px-3 py-2.5 text-[12.5px] font-semibold cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: "#fdecec", color: "#b91c1c" }}
            >
              <Trash2 size={13} aria-hidden="true" />
              {t("removeSection")}
            </button>
          </div>
          </>
          )}
        </>
        )}
        </SortableSection>
      ))}
      </SortableContext>
      </DndContext>

      {confirmDelete && (() => {
        const doomed = sections.find((s) => s.id === confirmDelete);
        if (!doomed) return null;
        const lessons = doomed.lessons.length;
        return (
          <ConfirmModal
            title={t("removeSectionConfirmTitle")}
            /*
             * Named and counted. "Are you sure?" is a question nobody can
             * answer; "Getting started and the 6 lessons in it" is the fact
             * the answer depends on, and the empty case says so instead of
             * warning about lessons that do not exist.
             */
            body={lessons > 0
              ? t("removeSectionConfirmBody", { title: doomed.title, count: lessons })
              : t("removeSectionConfirmBodyEmpty", { title: doomed.title })}
            confirmLabel={t("removeSection")}
            cancelLabel={t("cancelDescription")}
            busy={busy}
            onClose={() => setConfirmDelete(null)}
            onConfirm={() => run(async () => {
              setConfirmDelete(null);
              await deleteSection(doomed.id);
              await refresh();
            })}
          />
        );
      })()}

      {/* The course-level action, full width: it is the only thing to do on an
          outline that has no sections yet, and the one an author reaches for
          between chapters. Held back until the first read lands, because it
          writes: pressed over an outline we have not seen, it appends a module
          to a list the author cannot see the rest of. */}
      {loaded && (
        <AddCard
          title={t("addSection")}
          hint={t("addSectionHint")}
          disabled={busy}
          busy={busy}
          onClick={() => run(async () => {
            await createSection(productId, { title: t("newSection") });
            await refresh();
          })}
        />
      )}
    </div>
  );
}
