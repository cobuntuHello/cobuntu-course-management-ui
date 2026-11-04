import * as React from "react";
import { useCallback, useState } from "react";

/**
 * Where a failed write gets reported, for the components that cannot render it
 * themselves.
 *
 * The builder has three separate `useBusy` instances: the outline, each lesson
 * row, and the quiz authoring hook. Only the outline is in a position to show a
 * notice the author will see -- a row's own detail area is COLLAPSED most of
 * the time, so a rename that failed on a closed row would have reported itself
 * into a hidden box, which is barely better than the silence this replaces.
 *
 * So failures travel up to one banner at the top of the builder. One notice is
 * also easier to trust than four scattered ones.
 *
 * The default is a no-op rather than a throw, so `useBusy` keeps working in a
 * component mounted outside the provider (and in a test that renders a row on
 * its own) with only its local `error` to offer.
 */
export const WriteFailureContext = React.createContext<(message: string) => void>(() => {});

export function WriteFailureProvider({
    onFailure,
    children,
}: {
    onFailure: (message: string) => void;
    children: React.ReactNode;
}) {
    return <WriteFailureContext.Provider value={onFailure}>{children}</WriteFailureContext.Provider>;
}

/**
 * Run an async write, track that it is running, and REPORT IT WHEN IT FAILS.
 *
 * ── The bug this exists to end (T-101) ──────────────────────────────────────
 *
 * The previous version was:
 *
 *   const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } }
 *
 * No catch. So a rejected write cleared the busy state in `finally`, the
 * spinner stopped, every control came back, and the builder looked exactly as
 * it does after a successful save. The rejection became an unhandled promise
 * rejection in the console -- somewhere the author is not looking.
 *
 * The consequence is not a missing toast. The author carries on editing a
 * document the server never received, builds more on top of it, and finds out
 * on reload. Of the twenty-odd call sites, only the two upload paths had their
 * own inner try/catch; every other write in the builder failed in silence.
 *
 * ── Why it swallows rather than rethrows ────────────────────────────────────
 *
 * Rethrowing would be the usual instinct, but no caller awaits `run` except
 * those same two upload paths, and they already catch inside the callback. So
 * a rethrow would go straight back to being an unhandled rejection, which is
 * where this started. Catching HERE and surfacing `error` is what gets the
 * failure in front of the person it happened to.
 *
 * `run` returns a boolean so a caller that needs to know can branch -- for
 * example to leave a dialog open on failure rather than closing it over a
 * change that was not saved.
 *
 * ── On the message ──────────────────────────────────────────────────────────
 *
 * `error` is the SERVER's message. api-learning-authoring throws
 * `new Error(body.error ?? statusLine)`, so it is already a sentence written
 * for a person, and replacing it with a generic string would throw away the
 * only specific thing we know. The generic wording belongs in the caller's
 * notice title, which is translated by the host app; this hook holds no copy
 * of its own, so it stays free of an i18n namespace.
 */
export function useBusy() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const report = React.useContext(WriteFailureContext);

    const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
        setBusy(true);
        /*
         * Cleared on every attempt, so a retry that works does not leave the
         * previous failure on screen contradicting it.
         */
        setError(null);
        try {
            await fn();
            return true;
        } catch (err) {
            /*
             * The message is rendered verbatim, so anything that is not
             * already a sentence has to fall through to the generic. An
             * earlier version did `String(err)`, which turns a thrown object
             * into the literal "[object Object]" on screen -- caught by its
             * own test rather than in review.
             */
            const message =
                err instanceof Error && err.message ? err.message
                    : typeof err === "string" && err.trim() ? err
                    : "Something went wrong.";
            setError(message);
            // Also upward, to the one banner the author can actually see.
            report(message);
            return false;
        } finally {
            setBusy(false);
        }
    }, [report]);

    const clearError = useCallback(() => setError(null), []);

    return { busy, error, clearError, run };
}
