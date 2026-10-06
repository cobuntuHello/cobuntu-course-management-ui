import { apiClient } from "./api";
import type { CourseLessonMedia, CourseSection } from "./api-learning";
import { uploadResumable, oversizeFor, type UploadProgress } from "./resumable-upload";

/**
 * Course authoring — the writes behind /learning/:id/manage.
 *
 * ── Why none of these name a community ─────────────────────────────────────
 *
 * The READ side is community-scoped (`/communities/:tag/courses/...`) because a
 * syllabus is part of a storefront and carries the Learning gate. These are
 * addressed by section, lesson or media id with no community in the path, and
 * that is the backend's decision rather than an omission: threading a tag
 * through a write means trusting the caller to name the right community, and a
 * caller who names one they DO have Learning access to could then edit a course
 * belonging to one they do not. Writes gate on canManageProduct, which protects
 * the product rather than the page.
 *
 * So there is no tag to pass here, and adding one would be actively worse.
 */

export interface CourseLessonDraft {
  title: string;
  description?: string | null;
  isPreview?: boolean;
}

export interface CourseSectionDraft {
  title: string;
  description?: string | null;
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

export function createSection(productId: string, draft: CourseSectionDraft) {
  return apiClient<CourseSection>(`/api/courses/${encodeURIComponent(productId)}/sections`, {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateSection(sectionId: string, patch: Partial<CourseSectionDraft>) {
  return apiClient<CourseSection>(`/api/courses/sections/${encodeURIComponent(sectionId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSection(sectionId: string) {
  return apiClient<void>(`/api/courses/sections/${encodeURIComponent(sectionId)}`, {
    method: "DELETE",
  });
}

/**
 * Reorder every section at once, by listing their ids in the order wanted.
 *
 * A whole-list write rather than "move this one to index N". `order` is indexed
 * and not unique on purpose — two sections may briefly share a number without
 * the database objecting — so a per-item write would leave the list in a
 * half-applied state if the second call failed, and reads break ties on
 * createdAt, which is not the order anybody chose.
 */
export function reorderSections(productId: string, sectionIds: string[]) {
  return apiClient<void>(`/api/courses/${encodeURIComponent(productId)}/sections/order`, {
    method: "PUT",
    body: JSON.stringify({ sectionIds }),
  });
}

/* ── Lessons ──────────────────────────────────────────────────────────────── */

/**
 * Returns the created lesson, not `unknown`.
 *
 * The controller has always answered 201 with the row; nothing read it, so the
 * type said nothing. Bulk drop does read it: it creates a lesson per dropped
 * file and then uploads that file to it, so it needs the id of the thing it
 * just made. Typed to the one field that use depends on rather than the whole
 * row, so this does not become a second, drifting definition of a lesson.
 */
export function createLesson(sectionId: string, draft: CourseLessonDraft) {
  return apiClient<{ id: string }>(`/api/courses/sections/${encodeURIComponent(sectionId)}/lessons`, {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateLesson(lessonId: string, patch: Partial<CourseLessonDraft>) {
  return apiClient<unknown>(`/api/courses/lessons/${encodeURIComponent(lessonId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteLesson(lessonId: string) {
  return apiClient<void>(`/api/courses/lessons/${encodeURIComponent(lessonId)}`, {
    method: "DELETE",
  });
}

export function reorderLessons(sectionId: string, lessonIds: string[]) {
  return apiClient<void>(`/api/courses/sections/${encodeURIComponent(sectionId)}/lessons/order`, {
    method: "PUT",
    body: JSON.stringify({ lessonIds }),
  });
}

/**
 * Where the free preview ends.
 *
 * `lastFreeLessonId` is the last step somebody can reach without the course;
 * `null` means there is no free preview. One call rather than one per lesson,
 * because the boundary is ONE fact about the course: moving it from lesson 8
 * to lesson 2 by toggling rows is six writes, six re-reads, and six chances to
 * be interrupted halfway and leave the course giving away more than the author
 * meant to.
 */
export function setPreviewBoundary(productId: string, lastFreeLessonId: string | null) {
  return apiClient<{ freeCount: number }>(
    `/api/courses/${encodeURIComponent(productId)}/preview-boundary`,
    { method: "PUT", body: JSON.stringify({ lastFreeLessonId }) },
  );
}

/* ── Lesson media ─────────────────────────────────────────────────────────── */

/**
 * Upload one file to a lesson.
 *
 * Raw fetch rather than apiClient, and not for convenience: apiClient sets
 * `Content-Type: application/json` on every request. Multipart needs a
 * Content-Type that carries the boundary the browser generated, and there is no
 * way to write that header by hand correctly — so the header must be ABSENT and
 * left to the browser. Overriding it with "multipart/form-data" produces a
 * request with no boundary, which the server cannot parse at all.
 *
 * Same-origin with credentials, like every other upload here: the session
 * cookie is httpOnly, so it can only travel by the browser attaching it, and
 * the catch-all handler under app/api forwards the body as BYTES with the
 * caller's content-type intact.
 */
export async function uploadLessonMedia(
  lessonId: string,
  file: File,
  opts?: { signal?: AbortSignal; language?: string; kind?: "VIDEO" | "ATTACHMENT" | "CAPTION" },
): Promise<CourseLessonMedia> {
  const fd = new FormData();
  fd.append("file", file);

  /*
   * `kind` is ALWAYS sent, never left to the server's default.
   *
   * That default is `kind === 'ATTACHMENT' ? 'ATTACHMENT' : 'VIDEO'` — so an
   * omitted field files a PDF as a video, and the syllabus then offers to play
   * it. Sending it every time removes the question rather than relying on the
   * caller to remember which way the fallback leans.
   */
  /*
   * An explicit kind wins over sniffing the file.
   *
   * `mediaKindFor` reads the mime type, which is the right default for a bulk
   * drop where nobody said what the files are. It is the WRONG answer when the
   * author pressed a button that names the kind: choosing a PDF from "add
   * video" used to file it as an attachment and leave the lesson with no
   * video, silently. The button knows; the sniffer only guesses.
   */
  const kind = opts?.kind ?? mediaKindFor(file);
  fd.append("kind", kind);

  /*
   * Runtime is read HERE because nothing else will read it.
   *
   * We do not transcode, so there is no encoding step to extract metadata and
   * no server-side probe of the uploaded file — the column is populated from
   * whatever the client sends. Omit it and every lesson shows a file name with
   * no duration, which is the one number a buyer actually wants from a
   * syllabus.
   *
   * Best-effort: a container the browser cannot decode yields no duration, and
   * that is a missing runtime rather than a failed upload.
   */
  if (kind === "VIDEO") {
    const seconds = await readVideoDuration(file);
    if (seconds != null) fd.append("durationSeconds", String(Math.round(seconds)));
  }

  /*
   * A caption without a language is refused by the server, because <track>
   * needs `srclang` and a track without one shows as "Unknown" - two of them
   * become two identical entries in the captions menu.
   */
  if (kind === "CAPTION" && opts?.language) fd.append("language", opts.language);

  const res = await fetch(`/api/courses/lessons/${encodeURIComponent(lessonId)}/media`, {
    method: "POST",
    body: fd,
    credentials: "same-origin",
    signal: opts?.signal,
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // No JSON body — the status line is all there is to report.
    }
    throw new Error(message);
  }
  return (await res.json()) as CourseLessonMedia;
}

export function deleteLessonMedia(mediaId: string) {
  return apiClient<void>(`/api/courses/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
  });
}

/**
 * Which shelf a file belongs on.
 *
 * By mime type, not by extension: an extension is a claim the uploader's
 * operating system makes, and ".mov" on a PDF would put a document behind a
 * play button. A file the browser cannot type at all falls to ATTACHMENT,
 * which is the safe direction — an attachment that could have been played is
 * a download, while a document filed as a video is a broken player.
 */
export function mediaKindFor(file: { type?: string; name?: string }): "VIDEO" | "ATTACHMENT" | "CAPTION" {
  /*
   * Captions are decided by EXTENSION, not by mime type, and deliberately.
   *
   * Browsers disagree about what a .vtt is: Chrome says text/vtt, some send
   * text/plain, and a few send nothing at all. A type test would file a
   * caption as an attachment on those, and it would land in the downloads
   * list rather than the captions menu with nothing saying why. The server
   * checks the extension for the same reason.
   */
  if (file.name?.toLowerCase().endsWith(".vtt")) return "CAPTION";
  return file.type?.startsWith("video/") ? "VIDEO" : "ATTACHMENT";
}

/**
 * A video file's runtime in seconds, or null when the browser cannot tell.
 *
 * Reads metadata only — the element never downloads the body, so this costs a
 * header read rather than the file. The object URL is revoked on both paths;
 * leaking one pins the whole file in memory for the life of the tab, which for
 * course video is measured in gigabytes.
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      // Infinity turns up for some streamed/fragmented containers before a
      // seek. Reported as unknown rather than written to the database.
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

/* ── Direct-to-bucket upload ───────────────────────────────────────────────
 *
 * The path a course VIDEO takes, because it cannot take the multipart one
 * above: that request is served by a Next.js route on Vercel, which caps
 * request bodies at 4.5 MB before our code runs, and a course video is
 * routinely 50-100 MB. See lib/resumable-upload.ts.
 *
 * Two calls bracket an upload the app does not carry:
 *   1. open a session  - the server checks permission and names the object
 *   2. complete it     - the server reads the object back and makes the row
 *
 * A drop onto a MODULE targets the section and the LESSON IS CREATED BY STEP 2,
 * which is the fix for the orphan rows: a failed upload leaves nothing behind.
 * "Add a video" on an existing lesson targets that lesson instead.
 */

export type UploadTarget = { lessonId: string } | { sectionId: string };

const targetPath = (t: UploadTarget) =>
  "lessonId" in t
    ? `/api/courses/lessons/${encodeURIComponent(t.lessonId)}`
    : `/api/courses/sections/${encodeURIComponent(t.sectionId)}`;

export type UploadSession = { uploadUrl: string; objectPath: string; maxBytes: number };

export function createUploadSession(
  target: UploadTarget,
  file: { originalName: string; contentType: string; sizeBytes: number; kind?: "VIDEO" | "ATTACHMENT" | "CAPTION" },
) {
  return apiClient<UploadSession>(`${targetPath(target)}/upload-session`, {
    method: "POST",
    /*
     * ── The ORIGIN travels in the body, and it is load-bearing ────────────
     *
     * Cloud Storage stamps a resumable session with one origin, and the
     * response that COMPLETES the upload only carries
     * Access-Control-Allow-Origin when it matches the browser exactly. The
     * intermediate 308s are more forgiving, so getting this wrong fails only
     * on the final chunk, at around 90%, with a bare "Failed to fetch". That
     * is exactly how it shipped and how it was found.
     *
     * It cannot ride as a header: this is a relative call, and the Next.js
     * proxy in front forwards only Authorization, X-API-Key and Content-Type,
     * so the browser's Origin never reaches the service. The server fell
     * through to "*", which is not a permissive fallback here but the broken
     * case.
     *
     * `window.location.origin` rather than anything configured, because the
     * app is served from a different host per community (custom domains,
     * whitelabel) and only the browser knows which one it is on.
     */
    body: JSON.stringify({
      ...file,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    }),
  });
}

export function completeUpload(
  target: UploadTarget,
  body: {
    objectPath: string;
    originalName: string;
    kind?: "VIDEO" | "ATTACHMENT" | "CAPTION";
    durationSeconds?: number;
    language?: string;
    title?: string;
  },
) {
  return apiClient<CourseLessonMedia>(`${targetPath(target)}/upload-complete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The whole journey for one file: session, bytes, row.
 *
 * Wrapped here rather than left to each caller because the ORDER is the
 * correctness property. Creating the lesson first is what left sellers with
 * rows reading "No video yet" after every failure, and the only way to keep
 * that fixed is for there to be one place that knows the order.
 */
export async function uploadCourseFile(
  target: UploadTarget,
  file: File,
  opts: {
    kind?: "VIDEO" | "ATTACHMENT" | "CAPTION";
    language?: string;
    /*
     * What to call the lesson, when the server is the one creating it.
     *
     * Sent from the client rather than derived on the server because
     * `lessonNameFromFile` is doing real work that the server has no business
     * duplicating: "01-welcome-final.mp4" becomes "Welcome", not
     * "01-welcome-final". Stripping the extension is the SERVER's fallback for
     * a caller that sends nothing; it is not the rule.
     */
    title?: string;
    onProgress?: (p: UploadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<CourseLessonMedia> {
  const kind = opts.kind ?? mediaKindFor(file);

  /*
   * Refused HERE, before a session is even asked for.
   *
   * The server checks this too and is the authority; this only saves the round
   * trip, because the browser has known `file.size` since the person picked
   * the file. Thrown with the same wording the server uses, so the notice
   * reads identically whichever side caught it.
   */
  const tooBig = oversizeFor(file);
  if (tooBig) throw new Error(`${file.name} is ${tooBig.size}. The limit is ${tooBig.limit}.`);

  /* Read here, as the multipart path does, because nothing else will: we do
     not transcode, so there is no encoding step to extract metadata from. */
  const durationSeconds = kind === "VIDEO" ? await readVideoDuration(file) : null;

  const session = await createUploadSession(target, {
    originalName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    kind,
  });

  await uploadResumable(session.uploadUrl, file, {
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  return completeUpload(target, {
    objectPath: session.objectPath,
    originalName: file.name,
    kind,
    durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : undefined,
    title: opts.title,
    language: kind === "CAPTION" ? opts.language : undefined,
  });
}

/**
 * Attach a video that lives somewhere else (T-225).
 *
 * No bytes move. The server validates the link with YouTube (which is also how
 * it catches a private or embedding-disabled video before it becomes a lesson
 * that errors for every buyer) and writes the same row an upload would have.
 *
 * `durationSeconds` is read by the BUILDER before it calls this, from a
 * throwaway player (see readYoutubeDuration): YouTube's oEmbed does not report
 * duration, and the alternative - the Data API - costs a key and a quota to
 * learn something the player knows a second after it loads. Best effort, so
 * absent simply means the syllabus says nothing about this lesson's length.
 */
export function linkLessonVideo(
  target: UploadTarget,
  body: { url: string; title?: string; durationSeconds?: number },
) {
  return apiClient<CourseLessonMedia>(`${targetPath(target)}/video-link`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
