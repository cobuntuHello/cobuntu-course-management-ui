// Config-injected API client for the course-management package.
//
// The community-app and admin each compute the API base URL + auth differently
// (same-origin cookie vs NEXT_PUBLIC_API_URL + Bearer). Rather than hardcode a
// base like the community-app's own lib/api.ts does, this reads both from the
// CourseManagementConfig the host app provides via <CourseManagementConfigProvider>.
//
// Only `apiClient` lives here: the course AUTHORING surface (CourseBuilder, quiz
// editor) is entirely client-side. Server-side course reads (getCourse, public
// storefront listings) stay in community-app, where apiServer carries the SSR
// cache + publishable-key machinery that must not be duplicated.

import { getCourseManagementConfig } from "../config";

export type ApiClientOptions = RequestInit & { raw?: boolean };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public body?: any,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiClient<T = unknown>(
  path: string,
  options?: ApiClientOptions,
): Promise<T> {
  const { apiBaseUrl, authHeaders } = getCourseManagementConfig();

  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    // Same-origin apps (apiBaseUrl === "") let the browser attach the session
    // cookie; cross-origin apps authenticate via the injected Bearer header.
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let body: any = undefined;
    let code: string | undefined;
    try {
      body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
      if (body?.code) code = body.code;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, message, code, body);
  }

  // 204 (and empty bodies, e.g. DELETE) carry no JSON.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // `raw: true` returns the body as text (e.g. WebVTT captions) unparsed.
  if (options?.raw) return text as unknown as T;
  return (text ? JSON.parse(text) : undefined) as T;
}
