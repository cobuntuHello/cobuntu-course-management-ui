"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalCloseX } from "./ModalClose";

/**
 * One dialog that is a modal on a desktop and a bottom sheet on a phone.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every modal in this app had been rebuilding the same four things by hand:
 * the portal, the Escape key, the `items-end sm:items-center` switch that makes
 * it a sheet on a phone, and the muted close control. They drifted, which is
 * how one of them ended up with no Escape at all and another with a close
 * button only in the corner a thumb cannot reach.
 *
 * What none of them had was the part a sheet is actually judged on: it did not
 * MOVE. A bottom sheet that cannot be pushed down is a modal wearing a handle,
 * and the handle is then a lie about what the surface does. So the drag lives
 * here, once, rather than being the thing each caller skips.
 *
 * ── The drag ────────────────────────────────────────────────────────────────
 *
 * Only the header drags, not the whole panel. A sheet whose entire body is a
 * drag surface fights every scrollable thing inside it, and the fight is
 * invisible: the content scrolls a little, the sheet moves a little, and
 * neither does what the thumb asked. The handle and the title are the grip,
 * which is also where a thumb reaches for one.
 *
 * Release decides by DISTANCE OR SPEED. Distance alone punishes a flick, which
 * is how most people actually dismiss a sheet: a short, fast push should close
 * it even though it never travelled far. Anything else springs back, and the
 * spring is the same curve as the open, so a sheet that refuses to close does
 * not look broken.
 *
 * Dragging UP does nothing. A sheet that lifts off the bottom edge leaves a gap
 * under it, and there is nothing there to show.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 *
 * The panel is mounted one frame before it is shown, because a transition
 * cannot run from a state the element was never in. `prefers-reduced-motion` is
 * honoured by dropping the duration to zero rather than by removing the state
 * machine, so the open/close path is the same code in both cases.
 */

/** How far down the sheet must be pushed to dismiss, in px. */
const DISMISS_DISTANCE = 110;
/** Or how fast, in px per ms, so a short flick still closes it. */
const DISMISS_VELOCITY = 0.5;
/** Kept in step with the duration classes below. */
const ANIM_MS = 220;

export function ModalSheet({
    open,
    onClose,
    title,
    subtitle,
    label,
    children,
    footer,
    /**
     * Blocks every dismissal: Escape, the backdrop, the X and the drag. For the
     * stretch where closing would abandon something already in flight.
     */
    busy = false,
    closeLabel = "Close",
    /** `max-w-md` unless a caller needs more room. Desktop only. */
    widthClass = "sm:max-w-md",
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    /** For the dialog's accessible name when it differs from the visible title. */
    label?: string;
    children: ReactNode;
    footer?: ReactNode;
    busy?: boolean;
    closeLabel?: string;
    widthClass?: string;
}) {
    /** Mounted and painted at the closed position, so the open can animate. */
    const [mounted, setMounted] = useState(false);
    /** The transition target. */
    const [shown, setShown] = useState(false);
    /** Live finger offset while dragging, in px. Null when not dragging. */
    const [drag, setDrag] = useState<number | null>(null);
    const start = useRef<{ y: number; t: number } | null>(null);

    const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : ANIM_MS;

    useEffect(() => {
        if (open) {
            setMounted(true);
            /*
             * Two frames, not one. A single rAF still lands inside the same
             * paint in some browsers, and the panel then appears already open
             * with no transition at all.
             */
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
            return () => cancelAnimationFrame(id);
        }
        setShown(false);
        const id = setTimeout(() => { setMounted(false); setDrag(null); }, duration);
        return () => clearTimeout(id);
    }, [open, duration]);

    const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

    useEffect(() => {
        if (!mounted) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mounted, close]);

    /*
     * The page behind must not scroll while a sheet is over it. On iOS that is
     * not cosmetic: the page scrolls under the sheet and the sheet appears to
     * drift, which reads as the drag misbehaving.
     */
    useEffect(() => {
        if (!mounted) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = previous; };
    }, [mounted]);

    if (!mounted || typeof document === "undefined") return null;

    const onTouchStart = (e: React.TouchEvent) => {
        if (busy) return;
        start.current = { y: e.touches[0].clientY, t: Date.now() };
        setDrag(0);
    };
    const onTouchMove = (e: React.TouchEvent) => {
        if (!start.current) return;
        // Downward only: there is nothing above the top edge to reveal.
        setDrag(Math.max(0, e.touches[0].clientY - start.current.y));
    };
    const onTouchEnd = () => {
        const from = start.current;
        start.current = null;
        if (!from || drag == null) { setDrag(null); return; }
        const velocity = drag / Math.max(1, Date.now() - from.t);
        if (drag > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
            setDrag(null);
            close();
            return;
        }
        setDrag(null);
    };

    const dragging = drag != null && drag > 0;

    return createPortal(
        /*
         * PORTALLED TO BODY, and not optional. The community header carries
         * `backdrop-filter: blur()`, and a blurred element becomes the
         * containing block for its `position: fixed` descendants, so a scrim
         * rendered inside that subtree resolves against the header's box rather
         * than the viewport. See ModalClose for the same note.
         */
        <div
            className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={label ?? title}
        >
            <div
                className="absolute inset-0 bg-black/40 transition-opacity ease-out"
                style={{ opacity: shown ? 1 : 0, transitionDuration: `${duration}ms` }}
                onClick={close}
                aria-hidden="true"
            />

            <div
                className={`relative w-full ${widthClass} max-h-[92vh] overflow-hidden rounded-t-2xl shadow-xl sm:rounded-[var(--card-radius,16px)]`}
                style={{
                    background: "var(--bg-color)",
                    /*
                     * One transform drives three things: the open, the finger,
                     * and the close. While a finger is down the transition is
                     * off, or the panel lags behind the thumb by its duration
                     * and the drag feels broken rather than smooth.
                     */
                    transform: shown ? `translateY(${drag ?? 0}px)` : "translateY(16px)",
                    opacity: shown ? 1 : 0,
                    transition: dragging ? "none" : `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
                }}
            >
                {/* The grip: handle and heading together, because a thumb that
                    reaches for a sheet reaches for its top, not for a 4px bar. */}
                <div
                    className="touch-none"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onTouchCancel={onTouchEnd}
                >
                    {/* Decorative: the backdrop and the X both already dismiss. */}
                    <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
                        <span className="h-1 w-9 rounded-full" style={{ background: "rgba(128,128,128,0.3)" }} />
                    </div>

                    <ModalCloseX onClick={close} label={closeLabel} className="absolute right-4 top-4" />

                    <div className="px-6 pb-4 pt-5">
                        <h3
                            className="m-0 pr-10 text-[16px] font-semibold"
                            style={{ fontFamily: "var(--heading-font)", color: "var(--text-color)" }}
                        >
                            {title}
                        </h3>
                        {subtitle && (
                            <p className="m-0 mt-1 text-[12.5px] leading-snug" style={{ color: "var(--text-color)", opacity: 0.55 }}>
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>

                {/* The body scrolls on its own so a tall sheet never pushes its
                    footer off a short screen. */}
                <div className="max-h-[60vh] overflow-y-auto px-6">{children}</div>

                {footer && (
                    <div
                        className="flex gap-2 px-6 pt-4"
                        /* Clear of the home indicator when this is a sheet. */
                        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
                    >
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

/** The two footer buttons every one of these dialogs ends with. */
export function SheetFooterButtons({
    onCancel,
    onConfirm,
    cancelLabel,
    confirmLabel,
    confirmDisabled = false,
    busy = false,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    cancelLabel: string;
    confirmLabel: string;
    confirmDisabled?: boolean;
    busy?: boolean;
}) {
    return (
        <>
            {/* Side by side and equally wide, primary on the right where the eye
                finishes. Stacked, they read as two unrelated decisions. */}
            <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="flex-1 cursor-pointer px-5 py-3 text-[15px] font-medium transition-colors disabled:opacity-50"
                style={{
                    background: "rgba(128,128,128,0.1)",
                    color: "var(--text-color)",
                    border: "none",
                    borderRadius: "var(--button-radius, 8px)",
                }}
            >
                {cancelLabel}
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={confirmDisabled || busy}
                className="flex-1 cursor-pointer border-none px-5 py-3 text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                    background: "var(--primary-btn-bg, var(--brand-color))",
                    color: "var(--primary-btn-text, var(--brand-contrast, #fff))",
                    borderRadius: "var(--button-radius, 8px)",
                }}
            >
                {confirmLabel}
            </button>
        </>
    );
}
