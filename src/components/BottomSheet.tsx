"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Shared shell for every mobile bottom-sheet / desktop-centered-modal in the
 * app. Owns the backdrop, the slide-up / fade-in animation, the click-outside
 * + Escape close behaviour, and the drag indicator on mobile.
 *
 * Replaces the hand-rolled `<div className="fixed inset-0 …">` shell that
 * ShareModal, ProfileShareSheet, and CreateActionSheet each duplicated.
 * All three now mount through this wrapper, so the platform's "share sheet"
 * identity stays consistent — same motion, same chrome, same close gestures.
 *
 * Motion:
 *   Mobile (<sm): panel slides up from the bottom edge, backdrop fades in.
 *                 Spring eases the open; ease-out times the close.
 *   Desktop (sm+): panel fades in only — NO slide-up. A centered modal that
 *                  slides up from below feels disconnected from the trigger
 *                  (the trigger is somewhere on the page, not at the bottom
 *                  of the viewport). The variant is picked via matchMedia
 *                  the moment the sheet opens — see `useIsMobile` below.
 *
 * The panel is positioned to the bottom on mobile and centered on desktop;
 * the shared rounded-top corners look right on both because the sm: variant
 * adds full rounded corners and a small margin from the viewport edges.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Aria label for the dialog. Required — the sheet content varies per
   *  consumer, so we don't try to compute it. */
  ariaLabel: string;
  /** Hide the mobile drag-grabber. Most sheets keep it; the few that
   *  render their own header within the first row can opt out. */
  hideGrabber?: boolean;
  /*
   * There was a `grabberOverlay` here, floating the bar over a sheet's first
   * child so full-bleed artwork could reach the panel's top edge. The one sheet
   * that opened on artwork no longer does, and an overlay bar is wrong over
   * text (it sits on the words), so it went with its only caller rather than
   * staying as an option nothing takes.
   */
  /**
   * Desktop panel sizing. Defaults to the share-sheet width every consumer
   * wanted until now. A sheet whose content is a TABLE needs more room and a
   * height ceiling — without one the panel grows past the viewport and the
   * last rows fall off the bottom of the screen with no way to reach them
   * (the backdrop is `fixed`, so the page behind it cannot scroll either).
   *
   * Pass the ceiling here and `flex flex-col` + an `overflow-y-auto` child, so
   * the sheet scrolls INSIDE itself and its header and footer stay put.
   */
  panelClassName?: string;
  /**
   * Show a close control in the top-right corner — DESKTOP ONLY. Mobile keeps
   * the grabber + swipe-down + backdrop tap; a floating X there would fight the
   * drawer idiom. On desktop, where there is no drawer edge to grab, a muted
   * circular X is the expected way out. Off by default so the app's other sheets
   * are unchanged.
   */
  showDesktopClose?: boolean;
  /**
   * Drop the panel's hairline outline.
   *
   * The 1px rgba border reads as a pale ring around the sheet on a light page,
   * which on a sheet that is already a plain white card is a frame around a
   * frame. Opt-in, because the sheets that open over dark or busy content still
   * need that edge to separate the panel from the backdrop.
   */
  hideBorder?: boolean;
  /**
   * Fires once the close animation has fully finished (framer's onExitComplete).
   * Lets a caller keep the sheet mounted through its exit and only then act —
   * e.g. clear its data, or open the NEXT sheet without the two overlapping.
   */
  onClosed?: () => void;
  children: React.ReactNode;
}

/**
 * Tracks whether the viewport is below Tailwind's `sm` breakpoint (640px).
 * Uses `matchMedia` so we follow viewport resize as well as the initial
 * state. Returns null on the first SSR render so callers can branch into
 * a no-motion path until hydration tells them the actual width — avoids
 * the "slide animation fires on desktop because we assumed mobile" bug.
 */
function useIsMobile(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);
  return isMobile;
}

export function BottomSheet({ open, onClose, ariaLabel, hideGrabber, panelClassName = "sm:max-w-md", showDesktopClose, hideBorder, onClosed, children }: Props) {
  const isMobile = useIsMobile();

  // Escape-to-close — every modal pattern in the app honours this.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the sheet is open so the page underneath
  // doesn't shift on iOS Safari + Android.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Animation variants — split by viewport. On desktop we fade only; the
  // panel never moves vertically. On mobile we slide up from the bottom
  // edge. While `isMobile` is null (first render, before matchMedia
  // resolves) we render with no motion so a desktop visitor doesn't see
  // a one-frame slide before the fix kicks in.
  const panelMotion = isMobile === true
    ? {
        initial: { y: "100%", opacity: 1 },
        animate: { y: 0, opacity: 1 },
        exit: { y: "100%", opacity: 1 },
        transition: { type: "spring" as const, damping: 32, stiffness: 320, mass: 0.8 },
      }
    : isMobile === false
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15, ease: "easeOut" as const },
      }
    : {
        // Unknown viewport — render in place with no motion. AnimatePresence
        // still owns mount/unmount; only the panel's transform stays
        // neutral until we know which side of the breakpoint we're on.
        initial: false,
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      };

  // Portal to document.body so the backdrop covers the desktop header
  // (z-[52]) and any sticky page chrome. Rendering inline meant the
  // BottomSheet inherited whatever stacking context its trigger lived
  // in — on /events the trigger sits inside the right column's grid
  // cell, which trapped the z-60 below the page header. Surfaced by
  // PBN /events 2026-06-10 (header visibly bright while the sheet was
  // open).
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence onExitComplete={onClosed}>
      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
        >
          <motion.div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
          <motion.div
            // Fully rounded on desktop (centered modal); on mobile it's a
            // bottom sheet flush to the viewport edge, so the bottom corners
            // square off (max-sm override, !important to beat the inline radius).
            className={`relative w-full overflow-hidden max-sm:!rounded-b-none ${panelClassName}`}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
            style={{
              background: "var(--bg-color)",
              color: "var(--text-color)",
              borderRadius: "var(--card-radius, 16px)",
              border: hideBorder ? undefined : "1px solid rgba(128,128,128,0.15)",
            }}
          >
            {!hideGrabber && (
              <div className="sm:hidden flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(128,128,128,0.25)" }} />
              </div>
            )}
            {/* Desktop-only close. Mobile has the grabber + swipe + backdrop; a
                floating X there would fight the drawer. */}
            {showDesktopClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full sm:flex"
                style={{
                  background: "var(--bg-color)",
                  color: "var(--mut, #6b7280)",
                  border: "1px solid rgba(128,128,128,0.16)",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.16)",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
