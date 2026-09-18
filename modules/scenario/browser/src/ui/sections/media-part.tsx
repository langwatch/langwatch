/**
 * MediaPart — renders a single AG-UI media content part inline.
 */
import { Box, Icon, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, File, FileText } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { MediaProbing, MediaUnavailable } from "../elements/media-part-placeholder.tsx";
import { resolveMediaPart } from "../../model/media-part-source.ts";
import { resolveRawPcmFormat, wrapRawPcmToWav, type RawPcmFormat } from "../../model/pcm-to-wav.ts";
import type { MediaPartData } from "../../model/media-parts.ts";
import type { AudioPlaybackProps } from "../../behavior/use-sequential-audio-playback.ts";

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

function useMediaProbe(probe: MediaProbeResult, setStatus: Dispatch<SetStateAction<LoadStatus>>) {
  const probeFailed = probe === null;
  useEffect(() => {
    if (!probe) return;
    setStatus(probe.status === "available" ? "error" : "missing");
  }, [probe, setStatus]);
  useEffect(() => {
    if (probeFailed) setStatus("error");
  }, [probeFailed, setStatus]);
}

function useMediaLoadState({
  src,
  isUrlBased,
  storedObjectId,
  projectId,
  probe,
  onProbeRequired,
}: {
  src: string;
  isUrlBased: boolean;
  storedObjectId: string | null;
  projectId: string;
  probe: MediaProbeResult;
  onProbeRequired: MediaPartProps["onProbeRequired"];
}) {
  const [status, setStatus] = useState<LoadStatus>(isUrlBased ? "loading" : "ok");
  const probedRef = useRef<string | null>(null);
  useMediaProbe(probe, setStatus);

  // A new source must be able to probe even if the previous source failed.
  useEffect(() => {
    setStatus(isUrlBased ? "loading" : "ok");
    probedRef.current = null;
  }, [src, isUrlBased]);

  const handleLoad = useCallback(() => setStatus("ok"), []);
  const handleError = useCallback(() => {
    // Browser retries must not probe the same source repeatedly.
    if (probedRef.current === src) return;
    probedRef.current = src;
    if (!storedObjectId || !projectId) {
      setStatus("error");
      return;
    }
    setStatus("probing");
    if (onProbeRequired) {
      onProbeRequired(storedObjectId);
    } else {
      setStatus("error");
    }
  }, [src, storedObjectId, projectId, onProbeRequired]);

  return { status, handleLoad, handleError };
}

async function fetchWavUrl(
  src: string,
  format: RawPcmFormat,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(src, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const wav = wrapRawPcmToWav(bytes, format);
  if (!wav) throw new Error("empty audio payload");
  return URL.createObjectURL(new Blob([new Uint8Array(wav)], { type: "audio/wav" }));
}

function useRawPcmSource(src: string, format: RawPcmFormat | null, onError: () => void) {
  const [wrappedSrc, setWrappedSrc] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    if (!format) {
      setWrappedSrc(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void fetchWavUrl(src, format, controller.signal)
      .then((url) => {
        // A completed fetch may arrive after cleanup; it still owns its URL.
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setWrappedSrc(url);
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current();
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setWrappedSrc(null);
    };
  }, [src, format]);
  return wrappedSrc;
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

  const { status, handleLoad, handleError } = useMediaLoadState({
    src,
    isUrlBased,
    storedObjectId,
    projectId,
    probe,
    onProbeRequired,
  });
  const rawUrlFormat =
    storedObjectId && category === "audio" ? resolveRawPcmFormat(void 0, mimeType) : null;
  const wrappedSrc = useRawPcmSource(src, rawUrlFormat, handleError);

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

  return (
    <MediaAttachment
      part={part}
      src={src}
      storedObjectId={storedObjectId}
      mimeType={mimeType}
      isUrlBased={isUrlBased}
    />
  );
}

function MediaAttachment({
  part,
  src,
  storedObjectId,
  mimeType,
  isUrlBased,
}: {
  part: MediaPartData;
  src: string;
  storedObjectId: string | null;
  mimeType: string | undefined;
  isUrlBased: boolean;
}) {
  // binary fallback — attachment chip.
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
