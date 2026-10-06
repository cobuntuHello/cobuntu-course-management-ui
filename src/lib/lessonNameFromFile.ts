/**
 * A lesson title, from a video file's name.
 *
 * ── Why guess at all ────────────────────────────────────────────────────────
 *
 * Dropping ten videos onto a course creates ten lessons, and each one needs a
 * name. Leaving the raw filename would be safe and useless: "03-centring-final
 * -v2.mp4" is not a lesson title, so every author would rename every lesson by
 * hand, which is the thirty clicks the bulk drop exists to remove.
 *
 * So it guesses, and the guess is designed to be WRONG in a cheap direction.
 * The builder selects the first new title on open, so a bad guess costs one
 * keystroke; a missing guess costs a full rename each time.
 *
 * ── What it strips, and why each one ────────────────────────────────────────
 *
 * Leading ordinals ("03 - ", "1.") because the course's order is the list's
 * order and a number baked into the title goes stale the moment a lesson moves.
 * Trailing working words ("final", "v2", "export", "draft") because they are
 * notes to the editor, not to the learner. Separators become spaces, and the
 * result is sentence-cased rather than title-cased: "Centring the clay" reads
 * as a sentence, "Centring The Clay" reads as a headline nobody wrote.
 *
 * It deliberately does NOT strip trailing digits in general. "Week 2" and
 * "Part 3" are real titles, and a rule that ate them would be wrong in the
 * expensive direction on courses that are literally numbered.
 */

/** Editing scratch words, only ever removed from the END of a name. */
const WORKING_SUFFIXES = new Set([
    "final", "finals", "draft", "drafts", "export", "exported", "render", "rendered",
    "copy", "edit", "edited", "cut", "master", "new", "old", "raw", "fixed", "rev",
]);

/** "v2", "V10" — a version marker, not a lesson called V2. */
const VERSION = /^v\d+$/i;

/**
 * Strip the extension, whatever it is.
 *
 * Only the LAST dot, and only when what follows looks like an extension:
 * "Lesson 1. Centring.mp4" must lose ".mp4" and keep the rest, and a file
 * genuinely called "3.5" should not lose half of itself.
 */
function withoutExtension(fileName: string): string {
    return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

export function lessonNameFromFile(fileName: string): string {
    let name = withoutExtension(fileName);

    // Separators to spaces, before anything reads the words.
    name = name.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

    // A leading ordinal: "03", "1)", "2 -". The order lives in the list.
    name = name.replace(/^\d{1,3}\s*[).:-]?\s+/, "").trim();
    // The same, unseparated: a bare leading number followed by a word.
    name = name.replace(/^\d{1,3}\s+(?=\D)/, "").trim();

    // Trailing working words and version markers, however many are stacked up.
    let words = name.split(" ").filter(Boolean);
    while (words.length > 1) {
        const last = words[words.length - 1];
        if (WORKING_SUFFIXES.has(last.toLowerCase()) || VERSION.test(last)) {
            words.pop();
            continue;
        }
        break;
    }
    name = words.join(" ");

    /*
     * Sentence case, and only where the author has not already chosen a case.
     *
     * An all-lowercase or all-uppercase name came from a file system rather
     * than from a person, so capitalising the first letter is an improvement.
     * A name with mixed case was typed by someone who meant it, and
     * re-casing "How I throw a Yunomi" would be the tool overruling them.
     */
    if (name && (name === name.toLowerCase() || name === name.toUpperCase())) {
        const lower = name.toLowerCase();
        name = lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    /*
     * Never returns empty. A file called "01.mp4" strips down to nothing, and
     * a lesson with no title at all is worse than one called by its file: the
     * row becomes unclickable in a list of identical blanks.
     */
    return name || withoutExtension(fileName) || fileName;
}
