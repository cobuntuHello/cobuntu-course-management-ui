import { describe, it, expect } from "vitest";
import { splitRuntime, runtimeLabel, runtimeLabelFromSeconds, durationLabel } from "../lib/courseRuntime";

/**
 * How long a course is, written the way a person would say it.
 *
 * REPORTED from the manage page: a course announced itself as "Runtime
 * 1000 min". That is arithmetic the reader has to do before the number means
 * anything, and nobody describes a course that way.
 *
 * The storefront was worse in a quieter way: it reused `formatDuration`, the
 * PLAYER's clock, so the same course read "16:40:00" — which at a glance is
 * sixteen minutes and forty seconds.
 *
 * The clock stays where it belongs (a position you can seek to); totals get
 * this.
 */

/** Stands in for next-intl, with the same messages the catalogue carries. */
const t = (key: string, v: Record<string, string | number | Date> = {}) =>
  ({
    runtimeMinutes: `${v.minutes} min`,
    runtimeHours: `${v.hours}h`,
    runtimeHoursMinutes: `${v.hours}h ${v.minutes}m`,
    runtimeSeconds: `${v.seconds} s`,
  }[key] ?? key);

describe("splitRuntime", () => {
  it.each([
    [0, 0, 0],
    [41, 0, 41],
    [59, 0, 59],
    [60, 1, 0],
    [90, 1, 30],
    [227, 3, 47],
    [1000, 16, 40],
  ])("%i minutes is %ih %im", (total, hours, minutes) => {
    expect(splitRuntime(total)).toEqual({ hours, minutes });
  });

  it.each([[-5], [NaN], [Infinity]])("collapses %s to zero rather than printing nonsense", (bad) => {
    expect(splitRuntime(bad as number)).toEqual({ hours: 0, minutes: 0 });
  });

  it("rounds rather than truncating, so 59.6 minutes is not 59", () => {
    expect(splitRuntime(59.6)).toEqual({ hours: 1, minutes: 0 });
  });
});

describe("runtimeLabel", () => {
  it("writes the reported case as a person would say it", () => {
    // The actual number from the screenshot.
    expect(runtimeLabel(t, 1000)).toBe("16h 40m");
  });

  it("leaves a short course in minutes", () => {
    // "0h 41m" would be pedantry; nobody says it.
    expect(runtimeLabel(t, 41)).toBe("41 min");
  });

  it("drops the minutes on a whole hour", () => {
    // "2h 0m" reads as a measurement somebody forgot to finish.
    expect(runtimeLabel(t, 120)).toBe("2h");
  });

  it("handles the hour boundary from both sides", () => {
    expect(runtimeLabel(t, 59)).toBe("59 min");
    expect(runtimeLabel(t, 60)).toBe("1h");
    expect(runtimeLabel(t, 61)).toBe("1h 1m");
  });

  it("says 0 min for a course with nothing timed yet", () => {
    // Runtime only counts media that reported a duration, so this is a real
    // state and not a defensive branch.
    expect(runtimeLabel(t, 0)).toBe("0 min");
  });

  it("converts from seconds for callers holding a duration", () => {
    expect(runtimeLabelFromSeconds(t, 1000 * 60)).toBe("16h 40m");
    expect(runtimeLabelFromSeconds(t, 3470)).toBe("58 min");
  });

  it("keeps the units in the catalogue, not in the helper", () => {
    /*
     * "h" and "m" are not universal and neither is their order. The helper
     * only decides WHICH message applies — a hardcoded letter here would be
     * the hardcoded-string problem somewhere nobody would look for it.
     */
    const marker = (key: string) => `<${key}>`;
    expect(runtimeLabel(marker, 90)).toBe("<runtimeHoursMinutes>");
    expect(runtimeLabel(marker, 30)).toBe("<runtimeMinutes>");
    expect(runtimeLabel(marker, 60)).toBe("<runtimeHours>");
  });
});

describe("durationLabel", () => {
  /*
   * REPORTED from the builder: a lesson whose video had just finished
   * uploading showed "0 min". The row rounded seconds to whole minutes, so
   * Math.round(20 / 60) was 0 - and "0 min" next to a file you watched upload
   * reads as an upload that silently failed. Everything under 30 seconds did
   * it; everything from 30 to 89 claimed a flat "1 min".
   */
  it.each([
    [1, "1 s"],
    [20, "20 s"],
    [45, "45 s"],
    [59, "59 s"],
  ])("writes %is as %s rather than rounding it to minutes", (seconds, label) => {
    expect(durationLabel(t, seconds)).toBe(label);
  });

  it("switches to minutes at exactly a minute, not before", () => {
    expect(durationLabel(t, 59)).toBe("59 s");
    expect(durationLabel(t, 60)).toBe("1 min");
  });

  it("hands longer clips to runtimeLabel, so a lesson and a total agree", () => {
    expect(durationLabel(t, 180)).toBe("3 min");
    expect(durationLabel(t, 90 * 60)).toBe("1h 30m");
    expect(durationLabel(t, 120 * 60)).toBe("2h");
  });

  it("rounds to the nearest second rather than away from it", () => {
    expect(durationLabel(t, 0.4)).toBe("0 s");
    expect(durationLabel(t, 0.6)).toBe("1 s");
    expect(durationLabel(t, 59.6)).toBe("1 min");
  });

  it.each([[-5], [NaN], [Infinity]])("collapses %s to zero rather than printing nonsense", (bad) => {
    expect(durationLabel(t, bad as number)).toBe("0 s");
  });
});
