"use client";

import * as React from "react";

/**
 * The injection contract between the shared course-management UI and its
 * consuming apps. A course is a `products` row with productType=COURSE, so the
 * product form + manage page come from @cobuntu/product-management-ui; THIS
 * package owns the syllabus/quiz authoring surface (CourseBuilder) and the
 * learning API layer, which need a base URL + auth headers.
 *
 * Each app computes those differently:
 *   - community-app is same-origin, so it injects `apiBaseUrl: ""`.
 *   - admin injects `NEXT_PUBLIC_API_URL` and authenticates with a Bearer
 *     header.
 *
 * Wrap the course-management surface in `<CourseManagementConfigProvider
 * value={...}>` at the app layout that contains the create/manage pages.
 * Mirrors @cobuntu/product-management-ui's ProductManagementConfigProvider.
 */
export interface CourseManagementConfig {
  /** Base URL of the Cobuntu API (no trailing slash). "" = same-origin. */
  apiBaseUrl: string;

  /**
   * Authorization headers to attach to API requests. Called once per request;
   * should be cheap. Same-origin apps that authenticate by cookie return {}.
   */
  authHeaders: () => Record<string, string>;
}

const Ctx = React.createContext<CourseManagementConfig | null>(null);

/*
 * The same config, reachable without a hook — mirrors the product/event
 * packages. The API layer (api-learning*) is module-level functions that both
 * components and non-component callers import, so they read the config through
 * this non-hook accessor; the provider mirrors it on render and components
 * still read the CONTEXT via useCourseManagementConfig().
 */
let currentConfig: CourseManagementConfig | null = null;

/** Non-hook accessor for the module-level API helpers. */
export function getCourseManagementConfig(): CourseManagementConfig {
  if (!currentConfig) {
    throw new Error(
      "getCourseManagementConfig() called before <CourseManagementConfigProvider> rendered",
    );
  }
  return currentConfig;
}

export function CourseManagementConfigProvider({
  value,
  children,
}: {
  value: CourseManagementConfig;
  children: React.ReactNode;
}) {
  currentConfig = value;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCourseManagementConfig(): CourseManagementConfig {
  const cfg = React.useContext(Ctx);
  if (!cfg) {
    throw new Error(
      "useCourseManagementConfig() must be used within <CourseManagementConfigProvider>",
    );
  }
  return cfg;
}
