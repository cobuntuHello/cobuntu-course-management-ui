/**
 * A YouTube video, wearing enough of HTMLVideoElement to drive our own controls.
 *
 * ── Why an adapter and not YouTube's player ────────────────────────────────
 *
 * A course can now mix uploaded lessons and linked ones (T-225), and the thing
 * a learner must not notice is which. Two different players in one syllabus -
 * ours on lesson 1, YouTube's chrome on lesson 2 - is exactly the seam the
 * feature was asked to avoid.
 *
 * VideoControls already drives playback through a small, fixed surface:
 * play/pause, currentTime, duration, muted, playbackRate, buffered, and seven
 * events. That surface is the whole contract, so a YouTube player wearing it
 * can sit behind the same control bar with the bar none the wiser.
 *
 * ── What this cannot do ────────────────────────────────────────────────────
 *
 * Remove YouTube's branding. Their terms require playback through their player,
 * and pulling the stream out into our own <video> is a ban-grade violation
 * rather than a grey area. `modestbranding` was deprecated and does nothing.
 * So: our controls, our progress bar, our speed menu, and their wordmark in the
 * chrome. Roughly 90% of the way to identical, and the last 10% is not legally
 * available. T-226 (Vimeo) can go further, because its paid tiers allow hiding
 * the branding outright.
 */

/** The slice of HTMLVideoElement our controls actually use. */
export interface MediaLike {
    play(): Promise<void> | void;
    pause(): void;
    readonly paused: boolean;
    currentTime: number;
    readonly duration: number;
    muted: boolean;
    playbackRate: number;
    readonly buffered: { length: number; end(index: number): number };
    /*
     * OPTIONAL, and absent on a linked video. Captions on a YouTube lesson are
     * YouTube's own and live inside their player, not in <track> elements we
     * control - so there is nothing here to toggle and the caller passes
     * hasCaptions: false. Every read of it is guarded for that reason.
     */
    readonly textTracks?: ArrayLike<TextTrack> & Iterable<TextTrack>;
    /**
     * Captions that belong to the PROVIDER's player rather than to <track>
     * elements, present only on a linked video.
     *
     * It exists because the control bar has to be able to turn them off. Our
     * bar covers the provider's own chrome and that chrome is
     * `pointer-events-none`, so if we do not offer the toggle, nobody can
     * reach one: a learner reported captions "enabled by default and can't be
     * turned off", which is exactly that dead end.
     */
    readonly providerCaptions?: {
        enabled(): boolean;
        set(on: boolean): void;
    };
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

type YT = any;

let apiPromise: Promise<YT> | null = null;

/**
 * Load YouTube's IFrame API once per document.
 *
 * It installs a GLOBAL callback (`onYouTubeIframeAPIReady`) and fires it a
 * single time, so two components racing to add the script would leave the
 * second waiting for a callback that already happened. One shared promise, and
 * everything after the first call resolves from cache.
 */
function loadApi(): Promise<YT> {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise<YT>((resolve, reject) => {
        const w = window as any;
        if (w.YT?.Player) { resolve(w.YT); return; }

        const prior = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = () => {
            prior?.();
            resolve(w.YT);
        };
        const existing = document.querySelector('script[data-yt-iframe-api]');
        if (!existing) {
            const s = document.createElement("script");
            s.src = "https://www.youtube.com/iframe_api";
            s.async = true;
            s.dataset.ytIframeApi = "1";
            s.onerror = () => reject(new Error("Could not load the YouTube player"));
            document.head.appendChild(s);
        }
        // A blocked or very slow script must not leave the lesson spinning
        // forever with no explanation.
        setTimeout(() => reject(new Error("The YouTube player did not load")), 15000);
    });
    return apiPromise;
}

/**
 * Mount a YouTube player into `host` and return it dressed as a MediaLike.
 *
 * `destroy()` tears down both the player and the timer; the caller must call it
 * on unmount or a closed lesson keeps polling in the background forever.
 */
export async function createYouTubeMedia(
    host: HTMLElement,
    videoId: string,
    opts: { startAt?: number } = {},
): Promise<MediaLike & { destroy(): void }> {
    const YT = await loadApi();
    const listeners = new Map<string, Set<() => void>>();
    const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn());

    /**
     * Load or unload the caption module, under both of its names.
     *
     * "captions" is the legacy player's, "cc" the HTML5 one's, and which you
     * are given is not ours to choose. Acting on the one that is not there is
     * a no-op, so both are always addressed.
     */
    const setCaptionModule = (p: any, on: boolean) => {
        for (const name of ["captions", "cc"]) {
            try { on ? p.loadModule?.(name) : p.unloadModule?.(name); }
            catch { /* this player does not have that module; the other may */ }
        }
    };

    let ready = false;
    let loadedFraction = 0;
    /* Starts false, and truthfully: `cc_load_policy: 0` above means the player
       opens with captions off, so the bar's button is not lying when it says
       so before anyone has pressed anything. */
    let captionsOn = false;

    const player: any = await new Promise((resolve) => {
        const p = new YT.Player(host, {
            videoId,
            playerVars: {
                /* OUR controls, not theirs. The whole point of the adapter. */
                controls: 0,
                disablekb: 1,
                /* No "more videos from other channels" grid when a lesson ends:
                   a course should not hand its learner off to someone else's
                   content at the exact moment they finish a chapter. */
                rel: 0,
                playsinline: 1,
                /*
                 * Captions OFF unless the learner asks for them.
                 *
                 * Without this, YouTube decides: it turns captions on from the
                 * viewer's own account preference, or auto-generates them, and
                 * a lesson opens with burned-in text nobody chose. Reported as
                 * "the captions are enabled by default and can't be turned
                 * off" -- the second half of which was ours, see
                 * providerCaptions below.
                 */
                /*
                 * Kept, but it is NOT the off switch. Only `1` is meaningful
                 * here (force captions on); the default defers to the viewer's
                 * own YouTube preference. The actual turning-off happens in
                 * onReady below. Left in place because it does no harm and
                 * states the intent at the point someone looks for it.
                 */
                cc_load_policy: 0,
                start: Math.max(0, Math.floor(opts.startAt ?? 0)),
                origin: window.location.origin,
            },
            events: {
                onReady: () => {
                    ready = true;
                    /*
                     * TURN THEM OFF, actively. `cc_load_policy: 0` does not do
                     * it: in YouTube's API only `1` is meaningful (force ON),
                     * and the default means "whatever the viewer's own account
                     * prefers". I shipped `0` as if it were an off switch and
                     * the captions stayed on, which is the whole of the first
                     * attempt at this bug.
                     *
                     * Unloading the module is what their own CC button does,
                     * and it is the only reliable way to start a lesson with
                     * no captions over the picture.
                     *
                     * BOTH names, because the module is "captions" on their
                     * legacy player and "cc" on the HTML5 one, and which you
                     * get is not ours to choose. Unloading one that is not
                     * there is a no-op.
                     */
                    setCaptionModule(p, false);
                    captionsOn = false;
                    emit("loadedmetadata");
                    resolve(p);
                },
                onStateChange: (e: any) => {
                    if (e.data === YT.PlayerState.PLAYING) emit("play");
                    if (e.data === YT.PlayerState.PAUSED) emit("pause");
                    /*
                     * ENDED emits BOTH.
                     *
                     * `pause` because `paused` is now true and the control bar
                     * must stop showing a pause button, and `ended` because
                     * reaching the end is its own event the lesson shell acts
                     * on - it is what raises the end-of-lesson card. Collapsing
                     * the two, which this did at first, silently removed that
                     * card from every linked lesson.
                     */
                    if (e.data === YT.PlayerState.ENDED) { emit("pause"); emit("ended"); }
                },
                onPlaybackRateChange: () => emit("ratechange"),
            },
        });
    });

    /*
     * `timeupdate` and `progress` POLLED, because the IFrame API has no
     * equivalent events: it reports state changes, not position. 250ms is the
     * cadence a <video> fires timeupdate at, so the progress bar moves the same
     * way it does on an uploaded lesson - which is the point of all of this.
     */
    const timer = setInterval(() => {
        if (!ready) return;
        emit("timeupdate");
        const f = player.getVideoLoadedFraction?.() ?? 0;
        if (f !== loadedFraction) { loadedFraction = f; emit("progress"); }
    }, 250);

    return {
        play: () => player.playVideo(),
        pause: () => player.pauseVideo(),
        get currentTime() { return ready ? player.getCurrentTime() ?? 0 : 0; },
        set currentTime(v: number) { player.seekTo(v, true); },
        get duration() { return ready ? player.getDuration() ?? 0 : 0; },
        /* YouTube reports a state enum; 1 is PLAYING. Anything else - paused,
           buffering, cued, ended - is "not currently playing", which is what a
           play/pause button needs to know. */
        get paused() { return ready ? player.getPlayerState?.() !== 1 : true; },
        get muted() { return ready ? !!player.isMuted?.() : false; },
        set muted(v: boolean) { v ? player.mute() : player.unMute(); emit("volumechange"); },
        get playbackRate() { return ready ? player.getPlaybackRate?.() ?? 1 : 1; },
        set playbackRate(v: number) { player.setPlaybackRate(v); },
        /*
         * A TimeRanges shim. YouTube reports ONE fraction of the video it has
         * buffered, not the ranges a <video> exposes, so this is the closest
         * honest translation: a single range from zero to that fraction.
         */
        get buffered() {
            const end = (ready ? player.getDuration?.() ?? 0 : 0) * loadedFraction;
            return { length: end > 0 ? 1 : 0, end: () => end };
        },
        /*
         * Captions, through the provider's own module.
         *
         * The IFrame API has no caption property; it has a MODULE that is
         * loaded and unloaded, which is how the CC button inside their player
         * works. `loadModule` makes the track render, `unloadModule` removes
         * it. `getOption(..., 'tracklist')` answers undefined or an empty list
         * until the module has been loaded at least once, so availability is
         * probed by asking for the tracklist and treating "nothing yet" as
         * "offer the button anyway" would be wrong -- a button that does
         * nothing is worse than no button. We only claim captions exist once
         * the provider has named at least one track.
         */
        /*
         * No `available()` any more, and that is the second half of the first
         * attempt's failure.
         *
         * It asked `getOption("captions", "tracklist")`, which answers nothing
         * until the caption module has been LOADED at least once — so it was
         * false forever, the bar rendered no button, and captions could still
         * not be turned off. Probing by loading the module first would show the
         * captions in order to find out whether to offer to hide them.
         *
         * So the button is simply offered on every linked lesson. The cost is
         * a control that does nothing on a video with no captions; the cost of
         * the alternative was a learner watching an hour of burned-in text
         * with no way out. Pressing it on a video with no track unloads a
         * module that is not there, which is a no-op.
         */
        providerCaptions: {
            enabled() { return captionsOn; },
            set(on: boolean) {
                setCaptionModule(player, on);
                captionsOn = on;
            },
        },
        addEventListener(type: string, fn: () => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: () => void) {
            listeners.get(type)?.delete(fn);
        },
        destroy() {
            clearInterval(timer);
            listeners.clear();
            try { player.destroy?.(); } catch { /* already gone with the DOM */ }
        },
    };
}


/**
 * The video id in a pasted link, for the browser's own use.
 *
 * ── Yes, this is a second copy of a rule the server already has ────────────
 *
 * The server parses the link too, and its parse is the one that decides what
 * gets stored - this one never does. It exists only so the builder can mount a
 * throwaway player and read the runtime before submitting, which is not worth a
 * round trip to learn. Deliberately permissive in the same way, and if the two
 * ever disagree the server simply refuses and the author sees why.
 */
export function youtubeIdFromUrl(input: string): string | null {
    const raw = (input ?? "").trim();
    if (!raw) return null;
    const ID = /^[A-Za-z0-9_-]{11}$/;
    if (ID.test(raw)) return raw;
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (host.endsWith("youtu.be")) {
        const id = url.pathname.split("/").filter(Boolean)[0];
        return id && ID.test(id) ? id : null;
    }
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return null;
    const v = url.searchParams.get("v");
    if (v && ID.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]!.toLowerCase())) {
        return ID.test(parts[1]!) ? parts[1]! : null;
    }
    return null;
}

/**
 * How long a linked video runs, read from a throwaway player.
 *
 * ── Why the client does this and not the server ────────────────────────────
 *
 * oEmbed, which the server uses to check the link is real and embeddable, does
 * not report duration. The Data API does, at the cost of an API key, a quota
 * and a Google Cloud project - to learn something the player knows a second
 * after it loads.
 *
 * Without it a linked lesson stores no runtime, and a course mixing uploaded
 * and linked lessons shows "12 min" on some rows and nothing on others, which
 * reads as broken rather than deliberate.
 *
 * Best effort by design: a slow network or a blocked iframe API returns null,
 * the lesson is still created, and the syllabus is simply quiet about length -
 * exactly what it did before this existed. Never let it fail the link.
 */
export async function readYoutubeDuration(url: string, timeoutMs = 8000): Promise<number | null> {
    const id = youtubeIdFromUrl(url);
    if (!id || typeof document === "undefined") return null;

    // Off-screen rather than display:none: YouTube will not initialise a player
    // in a hidden container, so it has to be rendered and merely out of sight.
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-9999px;top:0;width:320px;height:180px;pointer-events:none";
    document.body.appendChild(host);

    let handle: { destroy(): void } | null = null;
    try {
        const media = await Promise.race([
            createYouTubeMedia(host, id),
            new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
        ]);
        if (!media) return null;
        handle = media;
        const seconds = media.duration;
        return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
    } catch {
        return null;
    } finally {
        handle?.destroy();
        host.remove();
    }
}
