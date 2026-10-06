/**
 * Can this file become a lesson?
 *
 * A lesson IS a video, so the drop zone that makes one lesson per file has to
 * turn everything else away. A PDF dropped there used to become a lesson with
 * nothing to play in it: a row in the syllabus, sold with the course, opening
 * on an empty player.
 *
 * ── Why this is not just `mediaKindFor(file) === "VIDEO"` ──────────────────
 *
 * It would be, except that `mediaKindFor` lives in the authoring API module,
 * which every test of the builder mocks wholesale. Reading the rule from there
 * meant the rule was `undefined` under test - the filter threw, the drop did
 * nothing, and four tests failed for a reason that had nothing to do with what
 * they were checking. A rule this load-bearing should not be reachable only
 * through a module people mock.
 *
 * ── Mime type, not extension ───────────────────────────────────────────────
 *
 * An extension is a claim the uploader's operating system makes. ".mov" on a
 * PDF would put a document behind a play button, which is the exact failure
 * this exists to prevent. A file the browser cannot type at all is refused:
 * here, unlike on the attachment shelf, the safe direction is to say no - a
 * video wrongly refused is one click to retry, a document wrongly accepted is
 * a broken lesson somebody paid for.
 */
export function isVideoFile(file: { type?: string; name?: string }): boolean {
  return !!file.type && file.type.startsWith("video/");
}
