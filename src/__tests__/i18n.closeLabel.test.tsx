import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { BottomSheet } from "../components/BottomSheet";

/**
 * The desktop close X on the builder's sheets speaks the host's language.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * BottomSheet's "Close" aria-label was a literal, with no way for a caller to
 * override it — unlike every other string in CourseBuilder/QuizEditor, which
 * already read from `useTranslations("learning.builder"/"learning.quiz")` (this
 * package, unlike event/management-ui-shared, is Next-only and uses next-intl
 * directly rather than a config-injected translator). A pt-PT community saw
 * "Close" on an otherwise-Portuguese sheet.
 *
 * `closeLabel` now threads BottomSheet -> BuilderModal -> both of CourseBuilder's
 * call sites, which already have `t` in scope and pass `t("close")`
 * ("learning.builder.close", unchanged by this fix).
 */
describe("BottomSheet closeLabel", () => {
  it("renders the host-supplied label on the desktop close button", () => {
    render(
      <BottomSheet open onClose={() => {}} ariaLabel="x" showDesktopClose closeLabel="Fechar">
        <p>body</p>
      </BottomSheet>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });

  it("falls back to English with no closeLabel passed", () => {
    render(
      <BottomSheet open onClose={() => {}} ariaLabel="x" showDesktopClose>
        <p>body</p>
      </BottomSheet>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("CourseBuilder.client.tsx wires closeLabel from its own t", () => {
  const src = readFileSync(join(__dirname, "..", "components", "CourseBuilder.client.tsx"), "utf8");
  const openIndices = [...src.matchAll(/<BuilderModal\b/g)].map((m) => m.index!);

  it("every <BuilderModal> call passes closeLabel={t(\"close\")}", () => {
    expect(openIndices.length).toBeGreaterThan(0);
    for (const at of openIndices) {
      const window = src.slice(at, at + 3000);
      expect(window).toMatch(/closeLabel=\{t\("close"\)\}/);
    }
  });
});
