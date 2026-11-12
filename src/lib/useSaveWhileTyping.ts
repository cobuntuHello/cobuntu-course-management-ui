"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * How long typing has to pause before a field saves on its own.
 *
 * Long enough that a word in progress is not a write per keystroke, short
 * enough that closing the tab right after typing rarely loses anything.
 */
export const SAVE_WHILE_TYPING_MS = 800;

/** What is unsent right now, as a write to run; null when nothing is. */
export type PrepareWrite = () => (() => Promise<unknown> | void) | null;

/**
 * Save a text field while it is being written, not only when it is left.
 *
 * The quiz fields used to save on blur and nowhere else, so a field that never
 * blurred lost its last edit: closing the dialog with Esc or a swipe while the
 * cursor was still in it, or closing the tab. Now a field saves:
 *
 *   - SAVE_WHILE_TYPING_MS after the typing stops (`schedule` on every change),
 *   - when it is left (`flush` on blur),
 *   - when it goes away (unmount, i.e. the dialog closing), automatically.
 *
 * `prepare` runs synchronously at flush time: it snapshots the draft, records
 * it as sent, and returns the write (or null when nothing is unsent). The
 * WRITES for one field are then chained, so a slow earlier save can never land
 * after a later one and leave the older text on the server.
 */
export function useSaveWhileTyping(prepare: PrepareWrite, delayMs = SAVE_WHILE_TYPING_MS) {
    const prepareRef = useRef(prepare);
    prepareRef.current = prepare;
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const chain = useRef<Promise<unknown>>(Promise.resolve());

    const flush = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        const write = prepareRef.current();
        if (!write) return;
        chain.current = chain.current
            .then(() => write())
            .catch(() => {
                /* surfaced by the caller's own error handling (useBusy) */
            });
    }, []);

    const schedule = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, delayMs);
    }, [delayMs, flush]);

    // The dialog closing unmounts the field: save whatever is still unsent.
    useEffect(() => () => flush(), [flush]);

    return { schedule, flush };
}
