/**
 * MediaPart — renders a single AG-UI media content part inline.
 *
 * Handles three shapes:
 *  - URL source (source.type="url" or binary with url set): renders native HTML5 element.
 *  - Inline data (source.type="data" or binary with data set): renders with a data: URI (legacy back-compat).
 *  - Missing: when the URL returns a 404/missing status, renders a placeholder badge.
 *
 * Uses native HTML5 <audio>, <img>, <video> — no third-party player library.
 */
import { Badge, Box, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

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
}

/**
 * Renders a single AG-UI media content part as a native HTML5 media element,
 * a data: URI, or a missing-badge placeholder.
 */
export function MediaPart({ part }: MediaPartProps) {
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

  const [status, setStatus] = useState<LoadStatus>(isUrlBased ? "loading" : "ok");

  // For URL-based parts, verify the file is reachable after the element reports an error.
  // We optimistically render and check on error, keeping the happy path cost-free.
  useEffect(() => {
    if (!isUrlBased) {
      setStatus("ok");
    }
  }, [isUrlBased]);

  function handleLoad() {
    setStatus("ok");
  }

  function handleError() {
    // Probe the URL to distinguish "missing" from other network errors
    fetch(src, { method: "GET", credentials: "include" })
      .then((r) => {
        if (r.status === 404) {
          setStatus("missing");
        } else {
          // Try to parse body for {status: "missing"} shape
          return r.json().then((body: unknown) => {
            if (
              typeof body === "object" &&
              body !== null &&
              (body as Record<string, unknown>).status === "missing"
            ) {
              setStatus("missing");
            } else {
              setStatus("error");
            }
          }).catch(() => {
            setStatus("error");
          });
        }
      })
      .catch(() => {
        setStatus("error");
      });
  }

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
          src={src}
          onLoad={handleLoad}
          onError={handleError}
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
        style={{ maxHeight: "200px", borderRadius: "6px" }}
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
          onLoad={handleLoad}
          onError={handleError}
          style={{ maxWidth: "400px", maxHeight: "300px", borderRadius: "6px" }}
        />
      </VStack>
    );
  }

  // binary fallback — link to download
  return (
    <Box data-testid="media-part-binary">
      <a href={src} download={part.type === "binary" ? part.filename : undefined}>
        {part.type === "binary" && part.filename ? part.filename : mimeType ?? "file"}
      </a>
    </Box>
  );
}
