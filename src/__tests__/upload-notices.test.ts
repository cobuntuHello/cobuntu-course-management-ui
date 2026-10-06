import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "./en.json";

/**
 * The notices a course upload can produce.
 *
 * ── What was wrong with them ───────────────────────────────────────────────
 *
 * Four of them, each a bare <p> with a hex colour, dropped into the page flow
 * between the module cards. An upload in progress, a rejected worksheet and a
 * failed video all carried the same visual weight as the body text around
 * them, and the longest read as a paragraph of prose with the filename buried
 * mid-sentence between two clauses of advice:
 *
 *   "These are heavier than most courses need: Course test video (30MB).mp4.
 *    They will play, but learners on phones will wait longer to start.
 *    Exporting at 1080p would look the same for most of them."
 */
const src = () =>
    readFileSync(join(__dirname, "..", "components/CourseBuilder.client.tsx"), "utf8");
const builder = (en as any).learning.builder;

describe("every upload notice is one component", () => {
    it("renders through UploadNotice rather than loose paragraphs", () => {
        const s = src();
        expect(s).toContain("export function UploadNotice(");
        // Progress, not-a-video, failed, bitrate — in the drop zone and on a
        // lesson row. Five sites, one component.
        expect((s.match(/<UploadNotice/g) ?? []).length).toBeGreaterThanOrEqual(5);
    });

    /*
     * The hand-rolled markup these replaced. A stray one is how two
     * vocabularies for the same event end up on one page again, which is
     * exactly the state this change found.
     */
    it("leaves no hand-coloured notice paragraphs behind", () => {
        const s = src();
        expect(s).not.toMatch(/<p className="text-\[13px\] m-0" style=\{\{ color: "#95681a" \}\}>/);
        expect(s).not.toMatch(/<p className="mt-2 mb-0 text-xs" style=\{\{ color: "#b91c1c" \}\}>/);
    });

    /*
     * Tones come from the vocabulary the builder already speaks: the amber of
     * the missing-captions chip, the red of the delete confirm. A notice that
     * invents its own palette does not look like it belongs to the page it
     * appears on.
     */
    it("reuses the builder's existing colour vocabulary", () => {
        const s = src();
        expect(s).toMatch(/caution: \{ bg: "#fff4de", fg: "#95681a"/);
        expect(s).toMatch(/problem: \{ bg: "#fdecec", fg: "#b91c1c"/);
    });
});

describe("the copy stops being prose", () => {
    /*
     * A list of files is a list. Writing it as a sentence makes the reader
     * parse grammar to find the filename, which is the one thing they need in
     * order to act.
     */
    it("names files as their own rows, not joined into the sentence", () => {
        const s = src();
        expect(s).toContain("files={bulk.failed}");
        expect(s).toContain("files={rejected}");
        // The old spelling: filenames interpolated into a sentence.
        expect(s).not.toContain('names: bulk.failed.join(", ")');
        expect(s).not.toContain('names: rejected.join(", ")');
    });

    it("splits each notice into a headline and a quieter why", () => {
        for (const k of ["noticeHeavyTitle", "noticeNotVideoTitle", "noticeFailedTitle"]) {
            expect(builder[k], `${k} missing`).toBeTruthy();
        }
        for (const k of ["noticeHeavyBody", "noticeNotVideoBody"]) {
            expect(builder[k], `${k} missing`).toBeTruthy();
        }
        // The headline is a headline: no full stop, and short enough to scan.
        expect(builder.noticeFailedTitle).not.toMatch(/\.$/);
    });

    /* One file and several are different sentences; a count glued to a plural
       noun reads as machine output ("1 files did not upload"). */
    it("uses real plurals rather than a bare count", () => {
        expect(builder.noticeFailedTitle).toMatch(/plural/);
        expect(builder.noticeHeavyTitle).toMatch(/plural/);
        expect(builder.noticeNotVideoTitle).toMatch(/plural/);
    });

    /*
     * A dead key is not inert here: the locale bundles are compared key for
     * key, so one left behind in 24 files drifts them apart and the parity
     * test starts reporting noise.
     */
    it("leaves no keys behind that nothing renders", () => {
        for (const dead of ["bitrateWarning", "bitrateWarningBulk", "uploadingPercent", "bulkFailed", "notVideoRejected"]) {
            expect(builder[dead], `${dead} is dead copy`).toBeUndefined();
        }
    });
});

describe("progress is readable", () => {
    /* An 86MB upload behind a line of text looks hung. The bar is the part
       that answers "is this moving" without reading. */
    it("draws a bar, not just a figure", () => {
        expect(src()).toMatch(/percent !== undefined && \(/);
        expect(src()).toContain('className="mt-2.5 block h-\[3px\] w-full overflow-hidden rounded-full"'.replace(/\\/g, ""));
    });

    /* `role="alert"` interrupts a screen reader. A failure earns that; an
       upload ticking along does not. */
    it("only interrupts a screen reader for a failure", () => {
        expect(src()).toMatch(/role=\{tone === "problem" \? "alert" : "status"\}/);
    });
});
