/**
 * Is this rich-text value actually empty?
 *
 * Quill never yields "". A document somebody opened, typed into and then
 * cleared comes back as `<p><br></p>`, and one they pasted a blank line into
 * can come back as `<p>&nbsp;</p>` or a stack of empty paragraphs. Saved
 * as-is, that is a description that renders as blank space and, worse, one the
 * UI believes EXISTS - so the "add a description" affordance never returns and
 * there is no way back to having none.
 *
 * So emptiness is decided on what the document would SAY, not on its length:
 * strip the tags, the entities that only produce whitespace, and the
 * whitespace itself, then ask whether anything is left. An `<img>` or an
 * `<iframe>` is not stripped, because a description that is only a picture is
 * still a description.
 */
export function richTextIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;

  const withoutVoidContent = html
    // Tags that can carry meaning with no text of their own survive as a
    // marker, so the checks below see them as content.
    .replace(/<(img|iframe|video|audio|embed)\b[^>]*>/gi, "\u0001")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ");

  return withoutVoidContent.trim() === "";
}
