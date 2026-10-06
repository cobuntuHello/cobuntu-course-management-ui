/**
 * How long something is, written the way a person would say it.
 *
 * ── Why this is not formatDuration ─────────────────────────────────────────
 *
 * `formatDuration` in CourseSyllabus renders a CLOCK: `1:30:00`. That is the
 * right shape for a player, where the number is a POSITION you can seek to and
 * the reader is comparing it against a progress bar.
 *
 * It is the wrong shape for a TOTAL. The course page and the builder both used
 * it, or used raw minutes, for "Runtime" — so a 1000-minute course announced
 * itself as "1000 min" in the builder and "16:40:00" on its storefront. The
 * first is arithmetic the reader has to do; the second reads as a timestamp,
 * and at a glance as sixteen minutes and forty seconds.
 *
 * A length people say out loud is "16h 40m", so that is what this prints.
 *
 * ── Why the caller passes `t` ──────────────────────────────────────────────
 *
 * "h" and "m" are not universal, and neither is their order. Formatting here
 * with hardcoded letters would be the hardcoded-string problem in a helper
 * where nobody would look for it, so the units stay in the message catalogue
 * and this only decides WHICH message applies.
 */

/** Hours and the remaining minutes. Negative and NaN collapse to zero. */
export function splitRuntime(totalMinutes: number): { hours: number; minutes: number } {
    const safe = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
    return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

/*
 * Matches next-intl's translator, which accepts only the value types ICU can
 * actually interpolate. A looser `unknown` here compiles in this file and
 * fails at every call site.
 */
type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * A total length: "41 min", "1h 30m", "2h".
 *
 * The whole-hour case drops the minutes rather than printing "2h 0m", which
 * reads as a measurement someone forgot to finish.
 */
export function runtimeLabel(t: Translate, totalMinutes: number): string {
    const { hours, minutes } = splitRuntime(totalMinutes);
    if (hours === 0) return t("runtimeMinutes", { minutes });
    if (minutes === 0) return t("runtimeHours", { hours });
    return t("runtimeHoursMinutes", { hours, minutes });
}

/** The same, from seconds, for callers that hold a duration rather than a count. */
export function runtimeLabelFromSeconds(t: Translate, totalSeconds: number): string {
    return runtimeLabel(t, (Number.isFinite(totalSeconds) ? totalSeconds : 0) / 60);
}
