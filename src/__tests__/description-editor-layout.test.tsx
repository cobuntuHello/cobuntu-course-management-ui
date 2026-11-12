/**
 * The section / lesson description editor fills its sheet and keeps its
 * buttons in the editor's own bottom row, next to the character counter,
 * matching the event and product description dialogs. Save still hands back
 * trimmed markdown, or null when nothing was written.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "./en.json";
import { DescriptionEditor } from "../components/CourseBuilder.client";

function renderEditor(value: string | null = "Old notes") {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DescriptionEditor value={value} placeholder="Describe this lesson" onCancel={onCancel} onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onSave, onCancel };
}

describe("DescriptionEditor (course builder)", () => {
  it("puts Cancel and Save in the same row as the counter", () => {
    renderEditor();
    const save = screen.getByRole("button", { name: "Save" });
    const row = save.parentElement!.parentElement!;
    expect(row.textContent).toContain("9 / 2000");
    expect(row.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(true);
  });

  it("Save hands back trimmed markdown; an empty draft saves as null", () => {
    const { onSave, container } = renderEditor();
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "  New notes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith("New notes");
    fireEvent.change(ta, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(null);
  });

  it("Cancel leaves without saving", () => {
    const { onSave, onCancel } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
