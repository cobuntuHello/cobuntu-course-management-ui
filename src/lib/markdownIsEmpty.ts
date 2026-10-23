/**
 * Is this markdown description value actually empty?
 *
 * Quill's HTML never yielded "" even for a cleared document (`<p><br></p>`,
 * `<p>&nbsp;</p>`), which is why this used to need to strip tags/entities
 * before asking. The editor is now a plain textarea whose value IS the
 * markdown source — a cleared document is really just whitespace, so a
 * trim is the whole check.
 */
export function markdownIsEmpty(markdown: string | null | undefined): boolean {
  if (!markdown) return true;
  return markdown.trim() === "";
}
