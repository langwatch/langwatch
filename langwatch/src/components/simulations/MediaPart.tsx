/**
 * MediaPart — renders a single AG-UI media content part inline.
 *
 * Handles three shapes:
 *  - URL source (source.type="url" or binary with url set): renders native HTML5 element.
 *  - Inline data (source.type="data" or binary with data set): renders with a data: URI (legacy back-compat).
 *  - Missing: when the URL returns a 404/missing status, renders a placeholder badge.
 *
 * Uses native HTML5 <audio>, <img>, <video> — no third-party player library.
 * Non-media binary parts (documents) render as an attachment chip that opens
 * the stored file in a new tab.
 */
import { Badge, Box, Icon, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, File, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveRawPcmFormat, wrapRawPcmToWav } from "~/shared/audio/pcmToWav";
import { api } from "~/utils/api";
import type { AudioPlaybackProps } from "./useSequentialAudioPlayback";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single AG-UI media content part, as produced after content-extraction.
 * This matches the subset of InputContentPart shapes we render.
 */
export type MediaPartData =
  | {
      type: "image" | "audio" | "video";
      source: { type: "url"; value: string; mimeType?: string };
    }
  | {
      type: "image" | "audio" | "video";
      source: { type: "data"; value: string; mimeType: string };
    }
  | {
      type: "binary";
      mimeType: string;
      id?: string;
      url?: string;
      data?: string;
      filename?: string;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the stored-object id from a stored-object URL, or returns null
 * when the URL does not match that pattern (e.g. an external URL).
 *
 * Handles both shapes: the project-scoped `/api/files/<projectId>/<id>`
 * (issue #4947) and the legacy id-only `/api/files/<id>`. The id is always
 * the final path segment; an optional project segment may precede it.
 *
 * Anchored to the start of the string: our minted URLs are root-relative
 * (`/api/files/...`), so a genuinely external URL that merely contains
 * "/api/files/" later in its path (e.g. `https://cdn.example/api/files/x`)
 * does NOT match and correctly returns null.
 */
function extractStoredObjectId(url: string): string | null {
  const match = /^\/api\/files\/(?:[^/?#]+\/)?([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

/** Resolve the media category from either a structured type or a mimeType string. */
function resolveMediaCategory(
  type: string,
  mimeType?: string,
): "audio" | "image" | "video" | "binary" {
  if (type === "image") return "image";
  if (type === "audio") return "audio";
  if (type === "video") return "video";
  if (mimeType) {
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
  }
  return "binary";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LoadStatus = "loading" | "ok" | "missing" | "error";

interface MediaPartProps {
  part: MediaPartData;
  /** Project that owns this stored object. Required for the server-side existence probe. */
  projectId: string;
  /**
   * Playback coordination — supplied by ScenarioMessageRenderer via
   * `useSequentialAudioPlayback().getAudioProps(id)`. When omitted the
   * <audio> element renders without coordination (standalone usage).
   */
  audioPlayback?: AudioPlaybackProps;
}

/**
 * Renders a single AG-UI media content part as a native HTML5 media element,
 * a data: URI, or a missing-badge placeholder.
 */
export function MediaPart({ part, projectId, audioPlayback }: MediaPartProps) {
  // Resolve src and category from the part shape
  let src: string;
  let mimeType: string | undefined;
  let category: "audio" | "image" | "video" | "binary";

  if (part.type === "binary") {
    mimeType = part.mimeType;
    category = resolveMediaCategory("binary", mimeType);
    if (part.url) {
      src = part.url;
    } else if (part.data) {
      src = `data:${mimeType};base64,${part.data}`;
    } else {
      src = "";
    }
  } else {
    mimeType = part.source.mimeType;
    category = resolveMediaCategory(part.type, mimeType);
    if (part.source.type === "url") {
      src = part.source.value;
    } else {
      // data URI — inline base64
      src = `data:${mimeType};base64,${part.source.value}`;
    }
  }

  const isUrlBased =
    src !== "" &&
    !src.startsWith("data:") &&
    (part.type === "binary" ? !!part.url : part.source.type === "url");

  const [status, setStatus] = useState<LoadStatus>(
    isUrlBased ? "loading" : "ok",
  );

  // Probe at most once per <src>: a single failed audio/video element can fire
  // `error` repeatedly while the browser retries decoders, and a long scenario
  // can render the same file id in many places.
  const probedRef = useRef<string | null>(null);
  // When true, the tRPC existence probe is fired once to distinguish
  // "missing" (row absent) from "error" (transient failure).
  const [probeEnabled, setProbeEnabled] = useState(false);

  // Extract the stored-object id from the URL so the tRPC probe can look it up.
  const storedObjectId = isUrlBased ? extractStoredObjectId(src) : null;

  // Server-side existence probe via tRPC — replaces the native fetch HEAD probe.
  // Inherits session auth automatically; no CORS / credential issues.
  const { data: probeData } = api.storedObjects.headById.useQuery(
    { projectId, id: storedObjectId ?? "" },
    { enabled: probeEnabled && !!storedObjectId && !!projectId },
  );

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

  // When the src changes (parent swaps to a different file id or switches from
  // URL-based to inline-data), reset both the load status and the probe guard
  // so the new src's first error is not silently swallowed.
  useEffect(() => {
    setStatus(isUrlBased ? "loading" : "ok");
    probedRef.current = null;
    setProbeEnabled(false);
  }, [src, isUrlBased]);

  function handleLoad() {
    setStatus("ok");
  }

  function handleError() {
    // Don't re-probe the same src after the first error; subsequent error
    // events for the same URL are noise (browser retry loops).
    if (probedRef.current === src) return;
    probedRef.current = src;

    // Enable the tRPC probe to distinguish "missing" (row absent) from
    // "error" (transient network/decode failure). The probe result is
    // handled in the useEffect above.
    setProbeEnabled(true);
  }

  // Legacy raw-PCM references: objects stored before store-time WAV wrapping
  // carry header-less pcm16 / G.711 bytes under a raw mime type — a bare
  // <audio src> cannot decode those. Fetch the bytes once, wrap them in a
  // WAV container client-side, and play from a blob URL. New objects are
  // wrapped at store time and never take this path.
  const rawUrlFormat =
    isUrlBased && category === "audio"
      ? resolveRawPcmFormat(undefined, mimeType)
      : null;
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
        const url = URL.createObjectURL(
          new Blob([wav as BlobPart], { type: "audio/wav" }),
        );
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
    };
    // handleError is a stable-in-practice component function; src/format are
    // the real inputs of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, rawUrlFormat]);

  // Missing or error placeholder
  if (status === "missing" || (status === "error" && src === "")) {
    return (
      <Box
        data-testid="media-part-missing"
        display="inline-flex"
        alignItems="center"
        gap={2}
        paddingX={3}
        paddingY={2}
        borderRadius="md"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border"
      >
        <Text fontSize="xs" color="fg.muted">
          {category} / {mimeType ?? "unknown"}
        </Text>
        <Badge colorPalette="gray" size="sm" variant="outline">
          missing
        </Badge>
      </Box>
    );
  }

  if (status === "error") {
    return (
      <Box
        data-testid="media-part-error"
        display="inline-flex"
        alignItems="center"
        gap={2}
        paddingX={3}
        paddingY={2}
        borderRadius="md"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border"
      >
        <Text fontSize="xs" color="fg.muted">
          {category} / {mimeType ?? "unknown"}
        </Text>
        <Badge colorPalette="red" size="sm" variant="outline">
          error
        </Badge>
      </Box>
    );
  }

  // Render native HTML5 element
  if (category === "audio") {
    return (
      <VStack align="flex-start" width="100%">
        {/* biome-ignore lint/a11y/useMediaCaption: captions not available for dynamically stored audio */}
        <audio
          data-testid="media-part-audio"
          controls
          // Legacy raw-PCM URLs wait for the client-side WAV wrap; an <audio>
          // without src renders a disabled shell instead of firing a decode
          // error for bytes the browser can never play.
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
        {/* biome-ignore lint/a11y/useMediaCaption: captions not available for dynamically stored video */}
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
    filename && storedObjectId
      ? `${src}?filename=${encodeURIComponent(filename)}`
      : src;
  const isDocumentLike =
    mimeType === "application/pdf" || (mimeType?.startsWith("text/") ?? false);
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
          <Icon
            as={isDocumentLike ? FileText : File}
            boxSize={4}
            color="fg.muted"
          />
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
