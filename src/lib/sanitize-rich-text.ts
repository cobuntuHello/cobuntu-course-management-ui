import sanitizeHtml from "sanitize-html";

/**
 * Sanitises + normalises user-authored rich-text HTML for rendering via
 * `dangerouslySetInnerHTML`.
 *
 * ── SECURITY (2026-08-05) ──
 *
 * This function was named "sanitize" but performed NO sanitisation: its only
 * job was replacing `&nbsp;` with spaces. It stripped no tags and no
 * attributes, while three call sites fed it member-authored HTML (product
 * descriptions, event descriptions) straight into `dangerouslySetInnerHTML`.
 * The name made that invisible at every call site — a reviewer seeing
 * `sanitizeRichDescription(product.description)` would reasonably conclude the
 * content was safe.
 *
 * There was also no `script-src` CSP to catch the result, and the auth cookie
 * (`cobuntu_auth`) is deliberately JS-readable and holds a 365-day token. So
 * any member who could create a product or event could execute script in every
 * viewer's browser and exfiltrate their session — full account takeover, and on
 * shared-domain communities the cookie spans every subdomain.
 *
 * It now runs a real allowlist sanitiser (sanitize-html: pure Node, so it works
 * unchanged in server components) BEFORE the nbsp normalisation.
 *
 * ── The allowlist ──
 *
 * Deliberately permissive about FORMATTING (this is body copy authored in a
 * rich-text editor — headings, lists, links, images and basic tables are all
 * legitimate) and strict about BEHAVIOUR: no <script>, no <style>, no <iframe>,
 * no event handlers, and only http/https/mailto/tel URLs — which also closes
 * `javascript:` and `data:` URI vectors on links.
 *
 * ── The nbsp normalisation (original purpose, unchanged) ──
 *
 * Incident 2026-05-21: PBN's event description — and many others authored via
 * the same editor — was stored with `&nbsp;` between EVERY pair of words and
 * zero regular spaces (what Word / Google Docs / Notion emit on paste). The
 * browser then treats the whole description as one unbreakable "word", and with
 * `overflow-wrap: break-word` it breaks mid-word ("business" → "bu siness"). A
 * pure-CSS fix is impossible because the stored data is already wrong, so we
 * repair it at render time to cover both existing and future rows.
 *
 * Legitimate uses of nbsp in body copy (e.g. "Mr. Smith") are rare and the cost
 * of losing them is nil — those phrases simply become breakable again.
 *
 * Order matters: sanitise FIRST, then normalise. Doing it the other way round
 * would let a payload smuggle characters past the sanitiser's parser.
 */

const RICH_TEXT_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    // Block / structure
    "p", "div", "span", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "code",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    // Inline formatting
    "strong", "b", "em", "i", "u", "s", "strike", "del", "ins",
    "sub", "sup", "small", "mark", "abbr",
    // Media / links
    "a", "img", "figure", "figcaption",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    // Editors emit alignment/width on table cells; harmless and needed for layout.
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    // Allow class ONLY where the editor uses it for formatting (e.g. text-align
    // helpers). No `style` anywhere — inline CSS is an injection surface
    // (url(), expression(), and layout-based clickjacking).
    "*": ["class"],
  },
  // http/https/mailto/tel only. Blocks javascript: and data: URIs.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {
    // Images may legitimately be inline data URIs (pasted screenshots), but
    // ONLY images — never links or anything script-capable.
    img: ["http", "https", "data"],
  },
  // Drop the CONTENT of these too, not just the tags — otherwise the inner text
  // of a <script> block would survive as visible page text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  // Force external links to be safe to click.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
      },
    }),
  },
};

export function sanitizeRichDescription(html: string | null | undefined): string {
  if (!html) return "";

  const safe = sanitizeHtml(html, RICH_TEXT_CONFIG);

  return safe
    // Literal entity form (most common — that's how the rich-text editor stores it).
    .replace(/&nbsp;/g, " ")
    // Already-decoded form (in case any path decodes entities before they reach
    // us, or paste stored the raw U+00A0 directly).
    .replace(/ /g, " ");
}
