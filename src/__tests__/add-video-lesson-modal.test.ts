import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "./en.json";

/**
 * One dialog holds both ways to put a video in a course.
 *
 * The builder used to show a drop zone with a quieter button under it, "Or link
 * a video you have online". That ranks the two before the author has said what
 * they have, and the author whose video is already on YouTube read the big
 * target first and the small grey line last, if at all. Both are answers to
 * "where is the video", so the card asks and the dialog holds both.
 *
 * Asserted against the source, which is what the rest of the learning suite
 * does for this component: mounting the real builder needs the config provider,
 * the upload client and four fetches standing up.
 */

const root = join(__dirname, "..");
const builder = readFileSync(join(root, "components/CourseBuilder.client.tsx"), "utf8");
const sheet = readFileSync(join(root, "components/ModalSheet.tsx"), "utf8");

describe("the two sources live in one dialog", () => {
    it("the card opens the dialog rather than the file picker", () => {
        /*
         * The whole point. A click that went straight to the file picker would
         * rule out the other source without ever naming it, which is the bug
         * the merge exists to fix.
         */
        expect(builder).toContain("onActivate={() => setOpen(true)}");
        expect(builder).toMatch(/if \(onActivate\) onActivate\(\); else inputRef\.current\?\.click\(\);/);
    });

    it("the dialog carries the upload zone AND the link field", () => {
        const modal = builder.slice(builder.indexOf("function AddVideoLessonModal"));
        expect(modal).toContain('title={t("addVideoUploadTitle")}');
        expect(modal).toContain('placeholder={t("linkVideoPlaceholder")}');
        // The rule between them, so neither reads as a footnote to the other.
        expect(modal).toContain('t("addVideoOr")');
    });

    it("dropping on the card still works without opening anything", () => {
        /*
         * A file already dragged over the page IS the answer. Making that
         * person open a dialog to say it again would be a step added for the
         * sake of symmetry.
         */
        const card = builder.slice(builder.indexOf("function AddLessonCard"));
        expect(card).toContain("onFiles={onFiles}");
    });

    it("choosing a file inside the dialog commits immediately", () => {
        // A confirm step after a file picker is a second click for a choice
        // already made. The footer's primary reads on the LINK, which can be
        // half-typed, not on the dialog as a whole.
        expect(builder).toContain("onFiles={(files) => { onFiles(files); onClose(); }}");
        expect(builder).toContain("confirmDisabled={!url.trim()}");
    });

    it("leaves no second entry point behind", () => {
        // The old standalone "Or link a video you have online" button. A
        // half-done merge would show both it and the dialog.
        expect(builder).not.toContain('t("linkVideo")');
        /*
         * Two drop zones only: the one the dialog holds and the one the card
         * is. A module footer rendering its own again would be the old
         * side-by-side layout coming back.
         */
        expect(builder.match(/<DropZone\b/g) ?? []).toHaveLength(2);
        // One link trigger only: the per-lesson strip.
        expect(builder.match(/<LinkVideoRow\b/g) ?? []).toHaveLength(1);
    });

    it("the per-lesson strip gets the link form with no upload half", () => {
        /*
         * That lesson's own strip already carries its upload control, so a
         * second one a centimetre away would be two ways to do one thing.
         * `onFiles` is what switches the upload half on, so its ABSENCE here
         * is the assertion.
         */
        const row = builder.slice(
            builder.indexOf("function LinkVideoRow"),
            builder.indexOf("function useBulkUpload"),
        );
        expect(row).toContain("<AddVideoLessonModal");
        expect(row).not.toContain("onFiles=");
    });

    it("does not promise an upload half it is not showing", () => {
        /*
         * Found by rendering it, not by reading it. The link-only form still
         * wore "Add a video lesson" over "Upload a file, or use a video you
         * already have on YouTube", with no upload anywhere on screen. The
         * heading has to follow the content.
         */
        expect(builder).toContain('title={both ? t("addVideoTitle") : t("linkVideoLabel")}');
        expect(builder).toContain('subtitle={both ? t("addVideoSubtitle") : t("linkVideoExplainer")}');
        expect(builder).toContain("const both = !!onFiles;");
    });

    it("every string it shows resolves", () => {
        const b = en.learning.builder as Record<string, string>;
        for (const key of [
            "addLessonCardTitle", "addLessonCardHint",
            "addVideoTitle", "addVideoSubtitle", "addVideoUploadTitle", "addVideoOr",
            "addLessonHint", "linkVideoLabel", "linkVideoPlaceholder",
            "linkVideoWarnTitle", "linkVideoWarning", "linkVideoConfirm", "linkVideoBusy",
        ]) {
            expect(b[key], key).toBeTruthy();
        }
    });
});

describe("the sheet is a sheet, not a modal wearing a handle", () => {
    it("drags down and dismisses on distance OR speed", () => {
        /*
         * Distance alone punishes a flick, which is how most people actually
         * dismiss a sheet: a short, fast push should close it even though it
         * never travelled far.
         */
        expect(sheet).toContain("onTouchStart");
        expect(sheet).toContain("onTouchMove");
        expect(sheet).toMatch(/drag > DISMISS_DISTANCE \|\| velocity > DISMISS_VELOCITY/);
    });

    it("never lifts off the bottom edge", () => {
        // A sheet dragged UP leaves a gap under it with nothing to show.
        expect(sheet).toContain("Math.max(0, e.touches[0].clientY - start.current.y)");
    });

    it("turns the transition off while a finger is down", () => {
        // Otherwise the panel lags the thumb by the animation duration, and the
        // drag reads as broken rather than smooth.
        expect(sheet).toContain('transition: dragging ? "none"');
    });

    it("only the header is a drag surface", () => {
        /*
         * A sheet whose whole body drags fights every scrollable thing inside
         * it, and the fight is invisible: the content scrolls a little, the
         * sheet moves a little, neither does what the thumb asked.
         */
        const grip = sheet.slice(sheet.indexOf('className="touch-none"'));
        expect(grip.indexOf("onTouchStart")).toBeLessThan(grip.indexOf("overflow-y-auto"));
    });

    it("animates from a state the element was actually in", () => {
        // A transition cannot run from a state never painted, so the panel is
        // mounted one frame before it is shown.
        expect(sheet).toContain("requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))");
    });

    it("honours prefers-reduced-motion by zeroing the duration", () => {
        // Not by removing the state machine: the open/close path must be the
        // same code in both cases, or one of them rots unnoticed.
        expect(sheet).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
        expect(sheet).toContain("const duration = reduced ? 0 : ANIM_MS;");
    });

    it("is a sheet on a phone and a modal on a desktop", () => {
        expect(sheet).toContain("items-end justify-center p-0 sm:items-center sm:p-4");
        expect(sheet).toContain("rounded-t-2xl shadow-xl sm:rounded-[var(--card-radius,16px)]");
    });

    it("keeps the muted X and the standard footer pair", () => {
        expect(sheet).toContain("<ModalCloseX");
        expect(sheet).toContain('className="absolute right-4 top-4"');
        // Side by side and equally wide; stacked they read as two unrelated
        // decisions.
        expect(sheet).toContain("flex-1 cursor-pointer px-5 py-3");
    });

    it("locks the page behind it", () => {
        // On iOS the page scrolls under the sheet and the sheet appears to
        // drift, which reads as the drag misbehaving.
        expect(sheet).toContain('document.body.style.overflow = "hidden"');
    });

    it("escapes the blurred header's containing block", () => {
        // A `fixed` scrim inside a `backdrop-filter` subtree resolves against
        // that header's box, not the viewport.
        expect(sheet).toContain("createPortal(");
        expect(sheet).toContain("document.body,");
    });
});
