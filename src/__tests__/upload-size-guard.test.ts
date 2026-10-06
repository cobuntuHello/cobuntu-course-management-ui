import { describe, it, expect } from "vitest";
import { oversizeFor, humanSize, MAX_UPLOAD_BYTES } from "../lib/resumable-upload";

/**
 * The size ceiling, as the browser applies it.
 *
 * A seller was refused on 2026-10-02 with "Claude workshop.mp4 is larger than
 * 2GB" — after a server round trip, for a limit that was inherited from
 * product attachments rather than chosen for video. The ceiling moved to 10 GB
 * and the refusal moved to the browser, which has known `file.size` since the
 * moment the file was picked.
 */
const f = (name: string, size: number) => ({ name, size });

describe("the ceiling the browser enforces", () => {
    it("lets a long workshop recording through", () => {
        expect(oversizeFor(f("Claude workshop.mp4", 3_400_000_000))).toBeNull();
    });

    it("refuses one that is genuinely over", () => {
        expect(oversizeFor(f("huge.mp4", 12_000_000_000))).toEqual({ size: "12.0 GB", limit: "10.0 GB" });
    });

    /*
     * DECIMAL, matching the server and every file manager a seller owns. A
     * binary ceiling (10 * 1024^3) would print "10 GB" while accepting a file
     * their Finder calls 10.5 GB — which is the confusion the old message
     * created by calling 2 GiB "2GB".
     */
    it("is decimal, so our number and their Finder's agree", () => {
        expect(MAX_UPLOAD_BYTES).toBe(10_000_000_000);
        expect(oversizeFor(f("a.mp4", 10_500_000_000))).not.toBeNull();
        expect(oversizeFor(f("a.mp4", 9_900_000_000))).toBeNull();
    });

    /* Both numbers. The old copy said the file was too big and nothing else,
       so nobody could tell whether to re-export or split the recording. */
    it("reports the file's real size as well as the limit", () => {
        const r = oversizeFor(f("x.mp4", 11_200_000_000))!;
        expect(r.size).toBe("11.2 GB");
        expect(r.limit).toBe("10.0 GB");
    });

    it("formats the smaller units a person would recognise", () => {
        expect(humanSize(30_704_510)).toBe("31 MB");
        expect(humanSize(2_400)).toBe("2 KB");
        expect(humanSize(512)).toBe("512 B");
    });
});

describe("where the check sits", () => {
    /*
     * In `uploadCourseFile`, which is the one journey both callers use — the
     * bulk drop and the per-lesson button. Putting it in either caller would
     * mean the other kept paying the round trip.
     */
    it("runs before a session is requested, not after", async () => {
        const src = (await import("fs")).readFileSync(
            (await import("path")).join(__dirname, "..", "lib/api-learning-authoring.ts"), "utf8");
        const guard = src.indexOf("const tooBig = oversizeFor(file);");
        const session = src.indexOf("await createUploadSession(");
        expect(guard).toBeGreaterThan(-1);
        expect(session).toBeGreaterThan(guard);
    });

    /* Same wording as the server's, so the notice reads identically whichever
       side caught it and nobody has to maintain two phrasings. */
    it("throws in the server's words", () => {
        const r = oversizeFor(f("Claude workshop.mp4", 12_000_000_000))!;
        expect(`Claude workshop.mp4 is ${r.size}. The limit is ${r.limit}.`)
            .toBe("Claude workshop.mp4 is 12.0 GB. The limit is 10.0 GB.");
    });
});
