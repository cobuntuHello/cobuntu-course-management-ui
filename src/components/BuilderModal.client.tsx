"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import { secondaryButtonStyle } from "./ModalClose";

/**
 * Whether the sheet body has content below the fold.
 *
 * ModalFooter is `sticky bottom-0`, so anything still to come passes UNDER
 * it, and macOS draws overlay scrollbars that stay invisible until you are
 * already scrolling. Put those together on a step that overflows by a little
 * - the Marking step gains one row when you choose "they have to pass it",
 * which is enough to push the instructions box past the edge - and the sheet
 * reads as if it simply ends there. It scrolled the whole time; nothing on
 * screen said so.
 *
 * So the footer asks the body whether there is more, and draws a soft lift
 * when there is. Not a rule across the sheet: a line there was removed on
 * purpose, because a permanent border turns one surface into a panel bolted
 * to the bottom. This is a shadow, it only exists while it is telling you
 * something, and it fades out as you reach the end.
 */
const MoreBelowContext = createContext(false);

/**
 * Tracks the same thing on resize, on scroll and on step change, because all
 * three change the answer: a step swap replaces the content, a textarea grows
 * as it is typed into, and rotating a phone re-lays the whole sheet out.
 */
function useMoreBelow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: fractional layout leaves sub-pixel remainders at the
    // bottom of a scroll box, and a permanent shadow is worse than none.
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    /*
     * A ResizeObserver on the BOX, for the viewport changing under it.
     *
     * Not on its child, which is what this did first and why the lift once
     * appeared over half a sheet of white space. The child is `flex-auto`
     * inside this box, so it always fills it: swapping a fourteen-row step for
     * a one-row step leaves the child EXACTLY the same height, and an observer
     * watching that height never fires. Only what is inside it changed, and a
     * ResizeObserver cannot see that.
     */
    const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    sizes?.observe(el);

    /*
     * So the content is watched as CONTENT. Every step swap, every question
     * added or removed, every character typed into the notes box changes what
     * is in here, and each of them changes the answer.
     *
     * Attributes are deliberately not observed, and that is what keeps this
     * from looping: `measure` sets state, the state changes the footer's
     * className, and an attribute mutation would call `measure` again. Without
     * them the only writes that can re-enter are ones that changed the DOM's
     * structure or its text, which is the question being asked.
     */
    const contents = new MutationObserver(measure);
    contents.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      /*
       * Attributes INCLUDED, and they are the half that makes this correct.
       *
       * Structure alone is measured too early. A step swap animates: the DOM
       * settles first and the heights settle over the next 140ms of inline
       * `style` that framer writes frame by frame. Watching structure only,
       * the last measurement landed mid-animation - it read 3px of overflow on
       * a step that ends with none, and the lift stayed drawn over half a
       * sheet of white space. Attribute mutations give a measurement per
       * animated frame, so the last one is taken when the layout has stopped
       * moving.
       *
       * It cannot loop. `measure` only writes state, that write only changes
       * the footer's className, and re-measuring after it yields the same
       * answer - so React bails out, nothing further is written, and the
       * cascade is two deep at most.
       */
      attributes: true,
    });

    return () => {
      sizes?.disconnect();
      contents.disconnect();
    };
  }, [measure]);

  return { ref, moreBelow, measure };
}

/**
 * The dialog the course builder puts its settings in.
 *
 * ── Why settings left the outline ──────────────────────────────────────────
 *
 * Every configuration control used to sit inline, so the page mixed three
 * different jobs on one surface: arranging lessons, writing about them, and
 * deciding how they behave. The outline stopped reading as an outline - a
 * lesson row carried a status chip that was secretly a switch, a quiz carried
 * a pair of native radios below its questions, and opening any lesson pushed
 * every row beneath it a screenful down the page.
 *
 * A setting is a decision you make once and leave, so it belongs somewhere
 * that takes the screen, states the choice in full, and gives back the
 * outline when you are done. That is also the only way the choice can be
 * explained at the length it deserves: a radio label has room for four words,
 * a card has room for the sentence that makes the choice obvious.
 *
 * ── On a phone it is a DRAWER, and not by hand ─────────────────────────────
 *
 * This wraps `BottomSheet`, the app's shared sheet shell, rather than a
 * hand-rolled overlay of its own. That shell already owns everything such an
 * overlay
 * gets subtly wrong: it slides up from the bottom edge on mobile and only
 * FADES on desktop (a centred modal that slides up from below feels
 * disconnected from a trigger that is somewhere in the middle of the page),
 * it renders through a portal so no ancestor's transform or backdrop-filter
 * can trap it, it squares off the bottom corners under `sm` so the drawer
 * sits flush to the viewport edge, and it carries the grabber that says
 * "this one swipes down". Escape, backdrop tap and body-scroll locking come
 * with it.
 *
 * Reimplementing that here is how the app ends up with two drawer idioms.
 */
export function BuilderModal({
  title,
  subtitle,
  onClose,
  stepKey,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /**
   * Which step is showing, for a sheet that has them.
   *
   * Two things follow from passing it, and neither is cosmetic.
   *
   * The sheet takes a FIXED height instead of growing to its contents. A
   * stepped sheet whose height tracks its body jumps on every step: the quiz
   * is tall, its Marking step is four rows, and a question is somewhere
   * between - so moving between them resized the panel under the reader, and
   * on a phone the footer you were reaching for moved while your thumb was on
   * the way to it.
   *
   * On desktop it is a FLOOR and a ceiling, not one height, and the difference
   * is the whole point. A single `h-` meant a step taller than 620px was
   * clipped to it: the Marking step with grading turned on came out 38px over,
   * so the instructions box was cut, and the 38px of scroll that existed was
   * too small to read as scrolling at all - reported twice as "it does not
   * scroll", which was the wrong diagnosis of a real bug. The floor keeps
   * every ordinary step the same height, so nothing resizes moving between
   * them; the ceiling lets a step that genuinely needs more take it, up to the
   * viewport, and only THEN scroll. Mobile keeps the single height: a phone
   * sheet that grows has nowhere to grow into.
   *
   * And the body cross-fades rather than cutting. Without it the swap is a
   * single frame, which reads as the whole sheet having been replaced rather
   * than as one surface changing what it holds - which is the entire point of
   * doing steps in one sheet instead of stacking dialogs.
   */
  stepKey?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const { ref: bodyRef, moreBelow, measure } = useMoreBelow();
  return (
    <BottomSheet
      open
      onClose={onClose}
      ariaLabel={title}
      showDesktopClose
      /*
       * A height ceiling plus `flex flex-col`, because the body below scrolls
       * inside the panel. Without the ceiling a lesson with eight attachments
       * grows the sheet past the viewport, and on mobile the backdrop is
       * `fixed`, so the page behind it cannot scroll to reach the rest either.
       */
      panelClassName={`sm:max-w-[520px] flex flex-col ${
        stepKey
          ? "h-[88vh] sm:h-auto sm:min-h-[min(85vh,620px)] sm:max-h-[88vh]"
          : "max-h-[88vh] sm:max-h-[85vh]"
      }`}
    >
      {/* The gap under the heading is pb-5 HERE plus pt-1.5 on the scrolling
          body below, and the split is the whole point - see the comment on
          that padding. Three attempts to fix the heading-to-input spacing by
          growing this number alone failed, because the number was never what
          was wrong. */}
      <div className="shrink-0 px-5 pb-5 pt-2 sm:pt-5">
        {/* No back crumb here. A two-step sheet's way back lives in the
            footer next to Save, because that is the other half of the same
            decision and it is where the hand already is. A crumb here was a
            second control for one move, at the far end of the sheet from it,
            stacked under the page's own breadcrumb. */}
        <h2 className="m-0 pr-8 text-[16px] font-bold leading-snug" style={{ fontFamily: "var(--heading-font)" }}>
          {title}
        </h2>
        {subtitle && <p className="m-0 mt-1 text-[12.5px] leading-relaxed opacity-60">{subtitle}</p>}
      </div>

      {/*
        * `pt-1.5`, and it is not decoration.
        *
        * This box is `overflow-y-auto`, so it CLIPS at its own top edge, and
        * the first thing in it is the title field - which wears `ring-1` and
        * `focus:ring-2`. A ring paints OUTSIDE the border box, so with no top
        * padding the ring's top edge was cut off by the scroll container and
        * the field read as clipped. SettingRow below it has the same problem:
        * it lifts on hover with `-translate-y-0.5` and a shadow, both of which
        * were being shaved off.
        *
        * This is why growing the header's `pb` never fixed it: padding on the
        * header moves the clip edge DOWN, and the field stays flush against
        * it, so the gap grew and the clipping stayed exactly the same.
        *
        * `flex flex-col` so ModalFooter's `mt-auto` has something to push
        * against - see ModalFooter.
        */}
      <div
        ref={bodyRef}
        onScroll={measure}
        /*
          * `flex-auto`, not `flex-1`, and that one word is what lets the sheet
          * size itself to the step it is holding.
          *
          * Both grow and both shrink; they differ in their BASE. `flex-1`
          * bases at 0, so this box contributed nothing to the panel's own
          * height and the panel fell back to its floor however tall the step
          * was - which is how a step 38px too big got clipped instead of
          * making the sheet 38px taller. `flex-auto` bases at the content, so
          * the panel grows to hold the step until it reaches the viewport
          * ceiling, and only then does `min-h-0` let this box shrink and start
          * scrolling.
          */
        className="flex min-h-0 flex-auto flex-col overflow-y-auto px-5 pt-1.5 pb-0"
      >
        <MoreBelowContext.Provider value={moreBelow}>
        {stepKey ? (
          /*
            * `mode="wait"` so the outgoing step is gone before the incoming one
            * arrives: run together they overlap inside a scroll container and
            * the panel scrolls to fit both for a frame.
            *
            * 140ms and 4px. Long enough to read as one surface changing, short
            * enough that it never sits between a tap and what the tap did.
            */
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepKey}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        ) : (
          children
        )}
        </MoreBelowContext.Provider>
      </div>
    </BottomSheet>
  );
}

/**
 * The row of buttons a dialog ends with.
 *
 * ── Right-aligned, and every one of them a real button ─────────────────────
 *
 * The lesson dialog used to end with a red "Remove lesson" that was styled as
 * a text link, alone on the left. Two problems. A destructive action drawn as
 * a link reads as navigation, and it was the only control in the dialog that
 * did not look like something you press. And there was no way OUT of the
 * dialog in the footer at all - the only close was the small X in the far top
 * corner, which on a tall sheet means scrolling back up to leave.
 *
 * So: one footer, right-aligned, buttons only. Leaving is always present and
 * always FIRST; the destructive action is last. The eye ends and the thumb
 * rests on the right, and that is exactly why delete goes there rather than
 * leave: the dangerous button is the one that should take a deliberate reach.
 * Put it under the thumb and somebody deletes a lesson they meant to close.
 *
 * ── And it is at the BOTTOM, whatever the sheet is holding ─────────────────
 *
 * Two rules do that, and it needs both.
 *
 * `mt-auto` handles a body SHORTER than the sheet. A stepped sheet is a fixed
 * height, so a four-row step used to leave the footer stranded halfway up with
 * an empty third of the panel under it - which reads as the dialog having been
 * cut off rather than as a dialog that ends there.
 *
 * `sticky bottom-0` handles a body TALLER than it. The footer carries the way
 * out and the destructive action, and in a quiz with nine questions both of
 * them used to scroll off the end, so leaving meant scrolling to find the exit
 * first.
 *
 * It therefore needs the sheet's own background (it has content passing under
 * it) and the horizontal padding the scroll box already applies, cancelled
 * with `-mx-5` and reapplied, so the fill reaches both edges. No rule above
 * it: the sheet has one surface, and a line drawn across it turned a row of
 * buttons into a separate panel bolted to the bottom. The opaque fill is
 * already enough to keep scrolling content from showing through. What it does
 * carry is a soft lift WHILE there is content still below it - see
 * MoreBelowContext - which is the one thing the removed rule was accidentally
 * doing right. The safe-area
 * inset lives here rather than on the body because this is now the thing at
 * the bottom of the screen: on an iPhone the home indicator sits over the last
 * 34px, and a delete button under it is one a thumb cannot reach cleanly.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  const moreBelow = useContext(MoreBelowContext);
  return (
    <div
      className={`sticky bottom-0 -mx-5 mt-auto flex flex-wrap items-center justify-end gap-2 border-none px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-shadow duration-200 ${
        moreBelow ? "shadow-[0_-10px_18px_-14px_rgba(24,24,27,0.55)]" : ""
      }`}
      /*
        * `var(--bg-color)`, NOT `bg-white`, and the difference is a visible
        * grey band rather than a nicety.
        *
        * `managed-surface` sits on <body> and re-points Tailwind's colour
        * variables at the community theme, including `--color-white`, which it
        * maps to the CARD surface: `color-mix(--text-color 3.5%, --bg-color)`.
        * That is right for a card, which is supposed to lift off the page. It
        * is wrong for this, which has to BE the page.
        *
        * And BottomSheet portals into document.body, so every sheet is inside
        * `managed-surface` however it was triggered. The panel paints itself
        * with `var(--bg-color)` inline, which the remapping never touches, so
        * `bg-white` here came out roughly 4% darker than the sheet it sits in
        * and drew a band across the bottom of every dialog in the builder.
        *
        * Reading the same token the panel reads makes them the same colour by
        * construction, on any theme, light or dark.
        */
      style={{ background: "var(--bg-color)" }}
    >
      {children}
    </div>
  );
}

/** The muted fill every secondary action in the app wears. */
export function ModalButton({
  children,
  onClick,
  disabled,
  tone = "muted",
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** `danger` is filled red; `primary` is the near-black confirm. */
  tone?: "muted" | "danger" | "primary";
  icon?: ReactNode;
}) {
  const style =
    tone === "danger"
      ? { background: "#b91c1c", color: "#fff", border: "none" }
      : tone === "primary"
        ? { background: "#18181b", color: "#fff", border: "none" }
        : secondaryButtonStyle;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-[var(--button-radius,0.75rem)] px-3.5 py-2.5 text-[13px] font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-40"
      style={style}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Ask before destroying something that took work to make.
 *
 * Deleting a section is the one action on this page that cannot be undone and
 * does not only affect what you clicked: the lessons hang off it by a foreign
 * key that cascades, so removing a chapter with six lessons in it removes six
 * lessons and every file uploaded to them, and nothing on the page said so.
 *
 * The count is in the question rather than in a footnote, because "this will
 * delete 6 lessons" is the whole of what somebody needs to know, and a person
 * who meant to delete an empty section should not have to read a warning
 * written for the other case.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  busy,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <BuilderModal title={title} onClose={onClose}>
      <p className="m-0 text-[13px] leading-relaxed opacity-70">{body}</p>
      <ModalFooter>
        {/* First, so the thumb resting at the right-hand end of the row is not
            resting on the button that destroys something. */}
        <ModalButton onClick={onClose}>{cancelLabel}</ModalButton>
        <ModalButton tone="danger" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </ModalButton>
      </ModalFooter>
    </BuilderModal>
  );
}

/**
 * One of two or three mutually exclusive settings, as a full-width card.
 *
 * Replaces a native `<input type="radio">`, which was the wrong control on
 * two counts. It is a 13px dot - below every touch-target guideline, and the
 * label beside it was the only thing big enough to hit. And it is painted by
 * the browser, so it arrived bright blue on a page themed in the community's
 * own colours, which made the one unbranded thing on screen the one thing the
 * eye went to.
 *
 * The card keeps the radio's semantics (`role="radio"` inside a
 * `role="radiogroup"`) so it still announces itself as one of a set, and adds
 * the room the explanation needed.
 */
export function ChoiceCard({
  selected,
  title,
  hint,
  onSelect,
  disabled,
}: {
  selected: boolean;
  title: string;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-start gap-3 border-[1.5px] border-solid p-3.5 text-left transition-colors cursor-pointer disabled:opacity-50"
      style={{
        /*
         * The community's CARD radius, not a fixed rounded-xl and not
         * --button-radius. This is a card that happens to be clickable - it
         * carries a title, a sentence and a selected state - so it should take
         * the shape the rest of the community's cards take. Leaving it
         * hardcoded also trips the button-radius guard, which reads the brand
         * colour on the border as a claim to follow the community's shape.
         */
        borderRadius: "var(--card-radius, 12px)",
        borderColor: selected ? "var(--brand-color, #18181b)" : "rgba(128,128,128,0.22)",
        background: selected ? "rgba(128,128,128,0.06)" : "transparent",
        color: "var(--text-color)",
      }}
    >
      <span
        className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-solid"
        style={{
          borderColor: selected ? "var(--brand-color, #18181b)" : "rgba(128,128,128,0.4)",
          background: selected ? "var(--brand-color, #18181b)" : "transparent",
        }}
      >
        {selected && <Check size={11} strokeWidth={3} color="#fff" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed opacity-60">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * An "add a thing" card.
 *
 * ── Lifted from the admin app's channel settings, not reinvented ───────────
 *
 * Cobuntu Studio already asks this question - "create channel", "new group" -
 * and answers it with a dashed card carrying an icon tile, a title and a line
 * saying what the thing is for. The course builder was asking the same
 * question with a 12px text link, so the two surfaces looked like different
 * products while doing identical work.
 *
 * The classes are copied from `channels/page.tsx` deliberately rather than
 * approximated: border-[1.5px] dashed zinc-300, rounded-2xl, a 36px zinc-100
 * icon tile, 13.5px semibold over 11.5px muted. Same numbers, so the two stay
 * recognisably one family.
 *
 * `compact` is for the ones nested inside a section, where a full card would
 * out-weigh the lessons it sits under.
 *
 * It lives here, beside the dialog pieces, because the outline and the quiz
 * panel both ask this question and both already import from this module.
 * Putting it in CourseBuilder and importing it from QuizEditor would be a
 * cycle - CourseBuilder imports QuizEditor.
 */
export function AddCard({
  title,
  hint,
  onClick,
  disabled,
  busy,
  compact,
}: {
  title: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      /*
       * The same lift the drop zone got: border firms up, the card rises a
       * hair and casts a short shadow, and the icon tile darkens and grows.
       * transition-all rather than transition-colors, because the movement is
       * half of what makes it read as pressable.
       */
      className={`group flex flex-1 cursor-pointer items-center gap-3 rounded-[var(--button-radius,1rem)] border-[1.5px] border-dashed border-zinc-300 bg-white text-left transition-all duration-150 hover:border-zinc-400 hover:bg-zinc-50/60 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-18px_rgba(60,40,30,0.55)] active:translate-y-0 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <span
        className={`grid shrink-0 place-items-center rounded-[11px] bg-zinc-100 text-zinc-500 transition-all duration-150 group-hover:bg-zinc-200 group-hover:text-zinc-700 group-hover:scale-105 ${
          compact ? "h-8 w-8" : "h-9 w-9"
        }`}
      >
        {busy
          ? <Loader2 size={compact ? 15 : 17} className="animate-spin" aria-hidden="true" />
          : <Plus size={compact ? 15 : 17} strokeWidth={2} aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold text-zinc-900 ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
          {title}
        </span>
        {hint && <span className="block text-[11.5px] text-zinc-500">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * A number with a minus and a plus beside it.
 *
 * ── Copied from the product builder's Stepper, not approximated ────────────
 *
 * `@cobuntu/product-management-ui` has exactly this control - it is what sets
 * stock on a physical variant and copies on a digital one - but it lives in
 * that package's `_primitives`, which is private and not re-exported, so it
 * cannot be imported. The classes are therefore copied verbatim rather than
 * eyeballed: a 96px centred field, 34px round zinc-100 pills, same focus ring.
 * Same numbers, so a pass mark and a stock count stay one control. (Exporting
 * it from the package would be the better fix; this is the one that does not
 * need a git-dep bump to ship.)
 *
 * The value is a STRING because empty is a real state and distinct from zero:
 * "how many tries" with nothing in it means unlimited, and a number input that
 * coerces that to 0 would silently say "no tries at all".
 */
export function NumberStepper({
  value,
  onChange,
  placeholder,
  min = 0,
  max,
  suffix,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const bump = (dir: number) => {
    const current = parseInt(value, 10);
    const base = Number.isFinite(current) ? current : min;
    const next = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, base + dir));
    onChange(String(next));
  };
  const pill =
    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-none bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 active:scale-90 cursor-pointer disabled:opacity-40 disabled:hover:bg-zinc-100";
  return (
    <div className="inline-flex shrink-0 items-center gap-2">
      <div className="relative">
        <input
          value={value}
          placeholder={placeholder}
          inputMode="numeric"
          aria-label={ariaLabel}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          className={`w-24 rounded-[var(--button-radius,0.5rem)] border border-solid border-zinc-200 bg-white py-2 text-center text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200 disabled:opacity-50 ${
            suffix ? "pl-2 pr-6" : "px-2"
          }`}
        />
        {/* Inside the field, not after the pills: it is part of the value, and
            after the plus it read as a label for the buttons. */}
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
      <button type="button" className={pill} disabled={disabled} onClick={() => bump(-1)} aria-label={`${ariaLabel ?? ""} -`.trim()}>
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={pill} disabled={disabled} onClick={() => bump(1)} aria-label={`${ariaLabel ?? ""} +`.trim()}>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
