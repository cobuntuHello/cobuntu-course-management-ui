"use client";

/**
 * How a modal is dismissed, in one place.
 *
 * ── The two halves ──────────────────────────────────────────────────────────
 *
 * `ModalCloseX` is the icon in the top-right. Its circle is a MUTED FILL that
 * is always there, not one that appears on hover — a dismiss is the control a
 * reader looks for once a modal has taken the screen, and on a touch device
 * there is no hover at all, so a hover-only affordance never appears.
 *
 * `modalCloseButtonStyle` is the full-width Close in the footer. It was an
 * outline, which reads as an equal sibling of whatever primary action sits
 * beside it. Close is secondary, so it takes the muted fill the rest of the
 * app gives secondary actions.
 *
 * Both together, not either/or: the footer button is the obvious target on a
 * phone where the top corner is a stretch, and the X is what a desktop reader
 * reaches for out of habit.
 *
 * ── Why inline styles ───────────────────────────────────────────────────────
 *
 * The community app themes per community through CSS variables, and these
 * surfaces have to sit on whatever background a leader chose. `rgba` greys
 * over the theme's own background stay legible on light and dark grounds
 * alike, where a fixed Tailwind zinc would not.
 */

import type { CSSProperties } from "react";

/** The muted secondary fill shared by both. */
const MUTED = "rgba(128,128,128,0.1)";
const MUTED_HOVER = "rgba(128,128,128,0.18)";

/**
 * Colour treatment for a secondary action (Cancel / Keep / dismiss) whose SIZE
 * the caller owns — spread this and add your own padding and radius.
 *
 * ── Why these buttons stopped being brand-themed ───────────────────────────
 *
 * They used to read `var(--secondary-btn-bg / -text / -border)`, the trio a
 * leader sets in Customize. That is fine on the storefront, where those
 * values were chosen against the section they sit on. It is not fine in a
 * MODAL, which renders on `var(--bg-color)` — a surface the leader never had
 * in mind when picking them.
 *
 * PBN made that concrete: `secondaryBtnBg: transparent`, `secondaryBtnText:
 * #ffffff`, `secondaryBtnBorder: #ffffff`, all correct against their dark
 * navy brand, and all invisible on the `#f8f9fa` modal. The Cancel button on
 * the event registration form was white on near-white — present, clickable,
 * and unreadable.
 *
 * So the colours here are deliberately NOT configurable. `--text-color` is
 * the one colour a leader has already guaranteed is legible on
 * `--bg-color`, and a 10% grey sits on either a light or a dark ground
 * without knowing which it got. Radius stays the caller's business, so
 * `--button-radius` still carries the brand's shape — the complaint was
 * contrast, not character.
 *
 * `DeclarativeRenderer` deliberately keeps the brand vars: it renders
 * storefront sections, which is exactly where the leader's own styling is
 * the point.
 */
export const secondaryButtonStyle: CSSProperties = {
    background: MUTED,
    color: "var(--text-color)",
    border: "none",
};

/** Full-width footer Close. Secondary, so filled rather than outlined. */
export const modalCloseButtonStyle: CSSProperties = {
    width: "100%",
    height: 46,
    borderRadius: "var(--input-radius, 10px)",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    background: MUTED,
    color: "var(--text-color)",
    fontFamily: "var(--body-font, system-ui)",
    transition: "background 0.15s",
};

export function ModalCloseX({ onClick, label = "Close", style, className }: {
    onClick: () => void;
    label?: string;
    style?: CSSProperties;
    /**
     * For a caller whose own CSS governs when the X is shown — AvatarEditor
     * hides it on mobile, where a drag handle is the close cue. Such a rule
     * needs !important, because `display` is set inline here.
     */
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={className}
            style={{
                width: 32, height: 32, flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                borderRadius: "50%", border: "none", cursor: "pointer",
                background: MUTED, color: "var(--text-color)",
                transition: "background 0.15s", padding: 0,
                ...style,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = MUTED_HOVER; }}
            onMouseLeave={e => { e.currentTarget.style.background = MUTED; }}
        >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ opacity: 0.75 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        </button>
    );
}

/** Hover handlers for the footer button, which cannot use :hover inline. */
export const modalCloseHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = MUTED_HOVER;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = MUTED;
    },
};
