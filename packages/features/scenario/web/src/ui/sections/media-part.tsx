/**
 * MediaPart — renders a single AG-UI media content part inline.
 *
 * Handles three shapes:
 *  - URL source (source.type="url" or binary with url set): renders native HTML5 element.
 *  - Inline data (source.type="data" or binary with data set): renders with a data: URI (legacy back-compat).
 *  - Unavailable: when the bytes are gone, or we cannot even find out, the
 *    element is replaced by a stated placeholder rather than left mounted.
 *
 * Uses native HTML5 <audio>, <img>, <video> — no third-party player library.
 * Non-media binary parts (documents) render as an attachment chip that opens
 * the stored file in a new tab.
 *
 * Every path out of loading is visible. A player that stays at zero seconds
 * with no explanation is indistinguishable from a silent recording, so a
 * failed element goes to a placeholder while the existence probe runs and
 * lands on a named state whether the probe answers or fails.
 */
import { Box, Icon, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, File, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaProbing, MediaUnavailable } from "../elements/media-part-placeholder";
import { resolveMediaPart } from "../../model/media-part-source";
import { resolveRawPcmFormat, wrapRawPcmToWav } from "../../model/pcm-to-wav";
import type { MediaPartData } from "../../model/media-parts";
import type { AudioPlaybackProps } from "../../behavior/use-sequential-audio-playback";

type LoadStatus = "loading" | "ok" | "probing" | "missing" | "error";

export type MediaProbeResult =
  | { status: "available"; mediaType: string }
  | { status: "missing"; mediaType: string }
  | { status: "not_found" }
  | null
  | undefined;

export interface MediaPartProps {
  part: MediaPartData;
  /** Project that owns this stored object. Required for the server-side existence probe. */
  projectId: string;
  /**
   * Playback coordination — supplied by ScenarioMessageRenderer via
   * `useSequentialAudioPlayback().getAudioProps(id)`. When omitted the
   * <audio> element renders without coordination (standalone usage).
   */
  audioPlayback?: AudioPlaybackProps;
  /** Result of the app-owned stored-object existence probe. */
  probe?: MediaProbeResult;
  /** Called once after a stored media element fails to load. */
  onProbeRequired?: (storedObjectId: string) => void;
}

/**
 * Renders a single AG-UI media content part as a native HTML5 media element,
 * a data: URI, or a missing-badge placeholder.
 */
export function MediaPart({
  part,
  projectId,
  audioPlayback,
  probe,
  onProbeRequired,
}: MediaPartProps) {
  const { category, isUrlBased, mimeType, notCaptured, src, storedObjectId, unsafeSrc } =
    resolveMediaPart(part);

  const [status, setStatus] = useState<LoadStatus>(isUrlBased ? "loading" : "ok");

  // Probe at most once per <src>: a single failed audio/video element can fire
  // `error` repeatedly while the browser retries decoders, and a long scenario
  // can render the same file id in many places.
  const probedRef = useRef<string | null>(null);
  // When true, the tRPC existence probe is fired once to distinguish
  // "missing" (row absent) from "error" (transient failure).

  const probeData = probe;
  const probeFailed = probe === null;

  // When the probe result arrives, map the tri-state to a load status:
  //   not_found → "missing"   (row was deleted / never existed — placeholder)
  //   missing   → "missing"   (row exists, blob is gone — feature requires placeholder)
  //   available → "error"     (server says bytes are there but the <audio>/<img>
  //                            still failed — transient decode/network issue)
  useEffect(() => {
    if (!probeData) return;
    if (probeData.status === "available") {
      setStatus("error");
    } else {
      setStatus("missing");
    }
  }, [probeData]);

  // The probe itself can fail: the caller may not hold the permission it
  // needs, or the request may not land at all. We then know the element failed
  // and nothing more, so the viewer gets the same "could not be loaded" answer
  // rather than a player parked at zero seconds forever.
  useEffect(() => {
    if (probeFailed) setStatus("error");
  }, [probeFailed]);

  // When the src changes (parent swaps to a different file id or switches from
  // URL-based to inline-data), reset both the load status and the probe guard
  // so the new src's first error is not silently swallowed.
  useEffect(() => {
    setStatus(isUrlBased ? "loading" : "ok");
    probedRef.current = null;
  }, [src, isUrlBased]);

  function handleLoad() {
    setStatus("ok");
  }

  function handleError() {
    // Don't re-probe the same src after the first error; subsequent error
    // events for the same URL are noise (browser retry loops).
    if (probedRef.current === src) return;
    probedRef.current = src;

    // An external URL, or no project context, leaves nothing to probe: no
    // second source of truth to wait for, so the failure is stated now.
    if (!storedObjectId || !projectId) {
      setStatus("error");
      return;
    }

    // The element has already failed, so it comes down now: leaving it mounted
    // is what made a lost recording look like a silent one. The placeholder
    // holds its place until the probe says which unavailable state it is.
    setStatus("probing");
    // Enable the tRPC probe to distinguish "missing" (row absent) from
    // "error" (transient network/decode failure). The probe result is
    // handled in the useEffect above.
    if (onProbeRequired) {
      onProbeRequired(storedObjectId);
    } else {
      setStatus("error");
    }
  }

  // Legacy raw-PCM references: objects stored before store-time WAV wrapping
  // carry header-less pcm16 / G.711 bytes under a raw mime type — a bare
  // <audio src> cannot decode those. Fetch the bytes once, wrap them in a
  // WAV container client-side, and play from a blob URL. New objects are
  // wrapped at store time and never take this path. Gated on
  // `storedObjectId`: only our own stored objects can BE legacy raw-PCM
  // refs, and an eager fetch of an arbitrary external URL would beacon the
  // viewer to whoever controls the part.
  const rawUrlFormat =
    storedObjectId && category === "audio" ? resolveRawPcmFormat(undefined, mimeType) : null;
  const [wrappedSrc, setWrappedSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!rawUrlFormat) {
      setWrappedSrc(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(src, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const wav = wrapRawPcmToWav(bytes, rawUrlFormat);
        if (!wav) throw new Error("empty audio payload");
        const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" }));
        // The cleanup may already have run while the bytes were in flight;
        // a URL minted after that point would leak forever, so revoke it
        // here instead of publishing it.
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setWrappedSrc(url);
      } catch {
        if (!cancelled) handleError();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Also drop the published state: a rapid src swap would otherwise
      // briefly point the <audio> at the just-revoked URL and fire a
      // spurious error before the new wrap resolves.
      setWrappedSrc(null);
    };
    // handleError is a stable-in-practice component function; src/format are
    // the real inputs of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, rawUrlFormat]);

  if (notCaptured) {
    return (
      <MediaUnavailable
        category={category}
        state="not captured"
        sizeBytes={notCaptured.sizeBytes}
      />
    );
  }

  // Missing or error placeholder
  if (unsafeSrc || status === "missing" || (status === "error" && src === "")) {
    return <MediaUnavailable category={category} state="missing" />;
  }

  if (status === "error") {
    return <MediaUnavailable category={category} state="error" />;
  }

  // The element failed and the probe has not answered yet.
  if (status === "probing") {
    return <MediaProbing />;
  }

  // Render native HTML5 element
  if (category === "audio") {
    // Legacy raw-PCM URLs are unplayable until the client-side WAV wrap
    // resolves; hold the placeholder rather than mounting a player with no
    // source, which reads as a broken recording.
    if (rawUrlFormat && !wrappedSrc) {
      return <MediaProbing />;
    }
    return (
      <VStack align="flex-start" width="100%">
        {/* Captions are not available for dynamically stored audio. */}
        <audio
          data-testid="media-part-audio"
          controls
          src={rawUrlFormat ? (wrappedSrc ?? undefined) : src}
          // `onLoad` does not fire on <audio>/<video>; the right hook is
          // `onLoadedData` (metadata + first frame ready) — fires only
          // after the browser has actually decoded enough to play, so
          // setting status="ok" here reflects what the user can do.
          onLoadedData={handleLoad}
          onError={handleError}
          onPlay={audioPlayback?.onPlay}
          onEnded={audioPlayback?.onEnded}
          ref={audioPlayback?.ref ?? null}
          style={{ width: "100%", maxWidth: "400px" }}
        />
      </VStack>
    );
  }

  if (category === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="media-part-image"
        src={src}
        alt={mimeType ?? "image"}
        onLoad={handleLoad}
        onError={handleError}
        // maxWidth caps upscaling in stretch layouts: without it a tiny
        // image (an 8x8 icon) inflates to container width.
        style={{
          maxHeight: "200px",
          maxWidth: "min(100%, 400px)",
          width: "auto",
          borderRadius: "6px",
        }}
      />
    );
  }

  if (category === "video") {
    return (
      <VStack align="flex-start" width="100%">
        {/* Captions are not available for dynamically stored video. */}
        <video
          data-testid="media-part-video"
          controls
          src={src}
          // See audio above — `onLoad` does not fire on <video>.
          onLoadedData={handleLoad}
          onError={handleError}
          style={{ maxWidth: "400px", maxHeight: "300px", borderRadius: "6px" }}
        />
      </VStack>
    );
  }

  // binary fallback — attachment chip. Stored-object URLs open in a new tab
  // (the /api/files read route serves Content-Disposition: inline, so PDFs
  // render in the browser's viewer); legacy inline base64 falls back to a
  // download, since browsers block top-frame navigation to data: URIs.
  // Stored objects are content-addressed and carry no filename of their own,
  // so pass the message-level one along — downloads from the opened viewer
  // then keep the original name instead of the object id.
  const filename = part.type === "binary" ? part.filename : undefined;
  const chipHref =
    filename && storedObjectId ? `${src}?filename=${encodeURIComponent(filename)}` : src;
  const isDocumentLike = mimeType === "application/pdf" || (mimeType?.startsWith("text/") ?? false);
  return (
    <Box asChild data-testid="media-part-binary">
      <a
        href={chipHref}
        {...(isUrlBased
          ? { target: "_blank", rel: "noopener noreferrer" }
          : { download: filename ?? "" })}
        aria-label={
          isUrlBased
            ? `Open ${filename ?? "attachment"} in a new tab`
            : `Download ${filename ?? "attachment"}`
        }
      >
        <Box
          display="inline-flex"
          alignItems="center"
          gap={2}
          paddingX={3}
          paddingY={2}
          borderRadius="md"
          bg="bg.subtle"
          border="1px solid"
          borderColor="border"
          _hover={{ bg: "bg.muted" }}
        >
          <Icon as={isDocumentLike ? FileText : File} boxSize={4} color="fg.muted" />
          <Text fontSize="sm" fontWeight="medium">
            {filename ?? mimeType ?? "file"}
          </Text>
          {isUrlBased && (
            <Icon
              as={ExternalLink}
              boxSize={3}
              color="fg.subtle"
              data-testid="media-part-binary-open"
            />
          )}
        </Box>
      </a>
    </Box>
  );
}
