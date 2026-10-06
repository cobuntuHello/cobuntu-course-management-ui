import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import en from "./en.json";

// Mirror community-app's test harness: next-intl is mocked so useTranslations
// resolves against the bundled en.json via createTranslator (the components use
// the "learning.builder" / "learning.quiz" namespaces). Tests still wrap in
// <NextIntlClientProvider locale="en" messages={en}> for parity.
beforeEach(() => {
  global.fetch = vi.fn().mockRejectedValue(new Error("fetch not mocked"));
});

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en", messages: en as any, namespace: namespace as any }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
