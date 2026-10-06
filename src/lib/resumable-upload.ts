/**
 * Upload a large file straight to Cloud Storage, resumably.
 *
 * ── Why the bytes do not go through our own API ────────────────────────────
 *
 * They cannot. The app posts to a relative path, which is served by a Next.js
 * route on Vercel, and Vercel caps a serverless function's request body at
 * 4.5 MB at the platform edge, before any of our code runs. The backend itself
 * accepts 2 GB. Sellers reported course videos of 67, 74 and 86 MB that "did
 * not upload", with no usable error, because a 413 from the edge is not
 * something our handler ever sees.
 *
 * So the server mints a resumable session (after checking the caller may upload
 * here) and the browser writes to Cloud Storage directly.
 *
 * ── Why resumable rather than one PUT ──────────────────────────────────────
 *
 * A single PUT is less code and works on a good connection. At 86 MB on hotel
 * wifi it is a coin flip, and a failure at 90% starts again from zero with
 * nothing to distinguish "slow" from "doomed". A resumable session can be asked
 * where it got to and continued from there, which is the difference between an
 * author getting a long video uploaded and giving up.
 */

/** 8 MiB. A GCS resumable chunk must be a multiple of 256 KiB. */
const CHUNK = 8 * 256 * 1024 * 4;

/** How many times a single chunk is retried before the upload is called off. */
const MAX_CHUNK_ATTEMPTS = 5;

export type UploadProgress = {
    /** Bytes confirmed STORED, not bytes handed to the socket. */
    sentBytes: number;
    totalBytes: number;
    percent: number;
};

export class UploadCancelled extends Error {
    constructor() {
        super("Upload cancelled");
        this.name = "UploadCancelled";
    }
}

/** A sleep that gives up when the caller cancels, rather than after the wait. */
function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    // 0.5s, 1s, 2s, 4s, capped. Long enough for a wifi handover to settle.
    const ms = Math.min(500 * 2 ** attempt, 8000);
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new UploadCancelled()); }, { once: true });
    });
}

/**
 * Ask the session how many bytes it already holds.
 *
 * This is the whole point of resumable. After a dropped connection we do not
 * know whether the last chunk landed, and re-sending one GCS already has is
 * both wasteful and, at a chunk boundary, wrong. A zero-length PUT with
 * `Content-Range: bytes * /<total>` answers it: 308 means "still going, here is
 * how far", and 200/201 means it is already complete.
 */
async function committedBytes(uploadUrl: string, totalBytes: number): Promise<number | "done"> {
    const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes */${totalBytes}` },
    });
    if (res.status === 200 || res.status === 201) return "done";
    if (res.status === 308) {
        const range = res.headers.get("Range");
        // No Range header means nothing has been committed yet.
        if (!range) return 0;
        const end = Number(range.split("-")[1]);
        return Number.isFinite(end) ? end + 1 : 0;
    }
    throw new Error(`Could not resume the upload (${res.status})`);
}

/**
 * Send `file` to an already-created resumable session.
 *
 * Returns when Cloud Storage has acknowledged the final byte. Throws
 * `UploadCancelled` if the caller aborts, and a plain Error with a readable
 * message otherwise - which is the thing the old code threw away.
 */
export async function uploadResumable(
    uploadUrl: string,
    file: File,
    opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
    const total = file.size;
    const report = (sent: number) =>
        opts.onProgress?.({ sentBytes: sent, totalBytes: total, percent: total ? (sent / total) * 100 : 0 });

    let offset = 0;
    report(0);

    /*
     * ── The attempt counter lives OUT here, and that is load-bearing ───────
     *
     * It was inside the chunk loop, reset on every pass. After a failure the
     * code probes the session for its committed length and starts the loop
     * again - so if the probe keeps reporting the same offset (a connection
     * that is down rather than flaky), the counter reset on every pass and the
     * upload retried forever, backing off politely, never finishing and never
     * giving up. Found by the test for the give-up message, which hung.
     *
     * Counting across the whole upload and clearing it only when the offset
     * actually ADVANCES is the honest rule: progress earns a fresh budget,
     * spinning does not.
     */
    let attempt = 0;

    while (offset < total) {
        if (opts.signal?.aborted) throw new UploadCancelled();

        const end = Math.min(offset + CHUNK, total);
        const chunk = file.slice(offset, end);

        for (;;) {
            try {
                const res = await fetch(uploadUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
                    },
                    body: chunk,
                    signal: opts.signal,
                });

                if (res.status === 200 || res.status === 201) {
                    report(total);
                    return;
                }
                if (res.status === 308) {
                    offset = end;
                    attempt = 0;      // real progress: a fresh budget
                    report(offset);
                    break;
                }
                /*
                 * 4xx is the session's answer about the REQUEST and retrying it
                 * unchanged cannot help: the content type does not match what
                 * the session was opened for, the length is wrong, or the
                 * session has expired. Retrying would spend the author's
                 * bandwidth to arrive at the same refusal.
                 */
                if (res.status >= 400 && res.status < 500) {
                    throw new Error(`The upload was refused (${res.status}). Start it again.`);
                }
                throw new Error(`Upload failed (${res.status})`);
            } catch (err) {
                if (opts.signal?.aborted) throw new UploadCancelled();
                if (err instanceof Error && /refused/.test(err.message)) throw err;

                attempt += 1;
                if (attempt >= MAX_CHUNK_ATTEMPTS) {
                    throw new Error(
                        `The connection kept dropping with ${Math.round((offset / total) * 100)}% uploaded. Try again when you have a steadier connection.`,
                    );
                }
                await backoff(attempt, opts.signal);

                /*
                 * Re-ask where the session got to rather than assuming the
                 * chunk failed. A connection that dies AFTER the server
                 * committed the bytes looks identical from here, and blindly
                 * re-sending from `offset` would then write the same range
                 * twice.
                 */
                const at = await committedBytes(uploadUrl, total);
                if (at === "done") { report(total); return; }
                // Only a session that moved forward resets the budget.
                if (at > offset) attempt = 0;
                offset = at;
                report(offset);
                break;
            }
        }
    }
}

/**
 * A file that is large for how long it runs.
 *
 * ── Why warn rather than refuse ────────────────────────────────────────────
 *
 * We do not transcode, so whatever an author exports is what every learner
 * streams, on every device. A ProRes master or a 4K export of a talking head is
 * a slow first frame on a phone and a bandwidth bill that scales with how well
 * the course sells. None of that makes the file WRONG, and refusing it would
 * block a seller over a judgement call about their own material.
 *
 * So it is a nudge, placed where the author can still act on it, and it fires
 * only when the number is bad enough to be worth a sentence: 10 Mbps is roughly
 * three times a comfortable 1080p H.264 upload, so anything above it is
 * carrying detail almost nobody will see.
 */
export const BITRATE_WARN_MBPS = 10;

export function overweightVideo(sizeBytes: number, durationSeconds: number | null): { mbps: number } | null {
    if (!durationSeconds || durationSeconds <= 0) return null;
    const mbps = (sizeBytes * 8) / durationSeconds / 1_000_000;
    return mbps > BITRATE_WARN_MBPS ? { mbps } : null;
}


/**
 * ── The ceiling, mirrored on the client ────────────────────────────────────
 *
 * The server is the authority and refuses an oversized file before a byte
 * moves, which is already the important half. But that answer costs a round
 * trip, and the browser has known `file.size` since the moment the person
 * picked it: there is no reason to ask a server whether a 12 GB file is under
 * 10 GB.
 *
 * It is a MIRROR, not a second source of truth. If the two ever disagree the
 * server wins, and the only cost of this being stale is one wasted round trip
 * ending in the same refusal with the same wording.
 *
 * Decimal, matching the server and every file manager a seller owns. A binary
 * ceiling would print "10 GB" while refusing a file their Finder calls 10.5 GB.
 */
export const MAX_UPLOAD_BYTES = 10_000_000_000;

/** Decimal, to match what the uploader's own file manager shows them. */
export function humanSize(bytes: number): string {
    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
    if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
    if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
    return `${bytes} B`;
}

/**
 * Too big to upload? Returns the two numbers a person needs, or null.
 *
 * Both of them, because the old message said only that the file was too big:
 * not how big it actually was, and not by how much they had missed. Someone
 * deciding whether to re-export or split a recording needs the gap.
 */
export function oversizeFor(file: { name: string; size: number }): { size: string; limit: string } | null {
    return file.size > MAX_UPLOAD_BYTES
        ? { size: humanSize(file.size), limit: humanSize(MAX_UPLOAD_BYTES) }
        : null;
}
