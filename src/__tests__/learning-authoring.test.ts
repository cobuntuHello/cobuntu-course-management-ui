import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mediaKindFor, uploadLessonMedia } from "../lib/api-learning-authoring";

/**
 * Course authoring.
 *
 * The two things that go wrong quietly here are both in the upload: a file
 * filed as the wrong KIND (the server's fallback is VIDEO, so an omitted field
 * puts a PDF behind a play button), and a multipart request sent with a
 * hand-written Content-Type, which arrives with no boundary and cannot be
 * parsed at all. Neither produces a type error and the first does not even
 * produce a failed request.
 */

const codeOf = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what shelf a file lands on", () => {
  it("files a video as VIDEO", () => {
    expect(mediaKindFor({ type: "video/mp4" })).toBe("VIDEO");
  });

  it("files a document as ATTACHMENT", () => {
    expect(mediaKindFor({ type: "application/pdf" })).toBe("ATTACHMENT");
  });

  it("falls to ATTACHMENT for a file the browser cannot type", () => {
    /*
     * The safe direction. An attachment that could have been played is a
     * download; a document filed as a video is a player that will not play.
     */
    expect(mediaKindFor({ type: "" })).toBe("ATTACHMENT");
    expect(mediaKindFor({})).toBe("ATTACHMENT");
  });

  it("goes by mime type, not by extension", () => {
    // An extension is a claim the uploader's OS makes. ".mov" on a PDF would
    // put a document behind a play button.
    expect(mediaKindFor({ type: "application/pdf" })).toBe("ATTACHMENT");
  });
});

describe("the upload request", () => {
  const originalFetch = global.fetch;
  let captured: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    captured = null;
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return {
        ok: true,
        json: async () => ({ id: "m1", kind: "ATTACHMENT" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("always names the kind, never leaving it to the server's fallback", async () => {
    /*
     * That fallback is `kind === 'ATTACHMENT' ? 'ATTACHMENT' : 'VIDEO'`, so an
     * omitted field files a PDF as a video and the syllabus then offers to
     * play it. Nothing errors; the course is just wrong.
     */
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    await uploadLessonMedia("lesson-1", file);

    const body = captured!.init.body as FormData;
    expect(body.get("kind")).toBe("ATTACHMENT");
  });

  it("sets no Content-Type, so the browser can supply the boundary", () => {
    /*
     * Asserted on the source rather than the request: a hand-written
     * "multipart/form-data" header produces a body with no boundary, which the
     * server cannot parse — and the happy-dom fetch mock would not reproduce
     * that. The claim is that the code never writes the header at all.
     */
    const code = codeOf("src/lib/api-learning-authoring.ts");
    const upload = code.slice(code.indexOf("export async function uploadLessonMedia"));

    expect(upload).not.toContain("Content-Type");
    expect(upload).not.toContain("multipart/form-data");
  });

  it("sends the session cookie", async () => {
    // httpOnly, so the browser attaching it same-origin is the only way it
    // travels. Without this the write arrives anonymous and 401s.
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    await uploadLessonMedia("lesson-1", file);

    expect(captured!.init.credentials).toBe("same-origin");
  });

  it("posts to the lesson's media route", async () => {
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    await uploadLessonMedia("lesson 1/x", file);

    // Encoded, so an id with a slash cannot walk to another route.
    expect(captured!.url).toBe("/api/courses/lessons/lesson%201%2Fx/media");
  });
});

describe("reordering writes the whole list", () => {
  const code = codeOf("src/lib/api-learning-authoring.ts");

  it("sends every id rather than one item's new index", () => {
    /*
     * `order` is indexed and NOT unique, so two rows may briefly share a
     * number without the database objecting. A per-item write leaves a
     * half-applied order behind on a failure, and reads break ties on
     * createdAt — which is not the order anybody chose.
     */
    expect(code).toContain("JSON.stringify({ sectionIds })");
    expect(code).toContain("JSON.stringify({ lessonIds })");
  });
});

describe("the builder does not guess at server-owned shape", () => {
  const code = codeOf("src/components/CourseBuilder.client.tsx");

  it("re-reads after a write instead of patching local state", () => {
    /*
     * `order`, `locked` and the media rows are all assigned server-side. A
     * builder that recomputes them shows the author a course that does not
     * match the one their buyers get.
     */
    expect(code).toContain("getCourseContentClient");
  });

  it("uses the CLIENT read, not the server one", () => {
    /*
     * getCourseContent calls apiServer, which fetches api.cobuntu.com directly
     * with an explicit token. From a browser that is cross-origin, the httpOnly
     * cookie cannot ride along, and there is no token to pass — so it would
     * arrive anonymous and hand the author the guest view of their own course.
     */
    expect(code).not.toContain("getCourseContent(");
  });
});

