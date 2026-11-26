import { Box, chakra, Spinner, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { CircleAlert, Image as ImageIcon, RotateCw, X } from "lucide-react";

const THUMB_SIZE = "52px";

function ThumbFace({
  name,
  src,
  failed,
  error,
  onRetry,
}: {
  name: string;
  src?: string;
  failed: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  if (failed) {
    return (
      <Box display="flex" alignItems="center" gap={2} height="full" paddingX={2.5} color="red.fg">
        <Box display="inline-flex" flexShrink={0}>
          <CircleAlert size={15} aria-hidden />
        </Box>
        <Box minWidth={0}>
          <Text textStyle="xs" fontWeight="medium" truncate>
            {name}
          </Text>
          <Text textStyle="2xs" truncate>
            {error ?? "Couldn't attach this image"}
          </Text>
        </Box>
        {onRetry ? <RetryUploadButton name={name} onRetry={onRetry} /> : null}
      </Box>
    );
  }
  if (!src) {
    return (
      <Box display="grid" placeItems="center" height="full" color="fg.subtle">
        <ImageIcon size={18} aria-hidden />
      </Box>
    );
  }
  return (
    <chakra.img
      src={src}
      alt={name}
      width="full"
      height="full"
      objectFit="cover"
      borderRadius="9px"
      display="block"
    />
  );
}

function RetryUploadButton({ name, onRetry }: { name: string; onRetry: () => void }) {
  return (
    <chakra.button
      type="button"
      aria-label={`Try uploading ${name} again`}
      onClick={onRetry}
      flexShrink={0}
      display="inline-flex"
      alignItems="center"
      gap={1}
      paddingX={1.5}
      height="22px"
      borderRadius="md"
      color="red.fg"
      cursor="pointer"
      textStyle="2xs"
      fontWeight="medium"
      _hover={{ background: "red.muted" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "orange.focusRing" }}
    >
      <RotateCw size={11} aria-hidden />
      Retry
    </chakra.button>
  );
}

function UploadingVeil({ name }: { name: string }) {
  return (
    <Box
      position="absolute"
      inset={0}
      display="grid"
      placeItems="center"
      borderRadius="9px"
      background="bg.panel/55"
    >
      <Spinner size="xs" aria-label={`Uploading ${name}`} />
    </Box>
  );
}

function RemoveImageButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <chakra.button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={onRemove}
      position="absolute"
      top="-6px"
      right="-6px"
      width="18px"
      height="18px"
      display="grid"
      placeItems="center"
      borderRadius="full"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.emphasized"
      background="bg.panel"
      color="fg.muted"
      cursor="pointer"
      boxShadow="sm"
      _hover={{ color: "fg" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "orange.focusRing" }}
    >
      <X size={11} aria-hidden />
    </chakra.button>
  );
}

/** An image in the row above the composer's text: its thumbnail, upload state and remove button. */
export function LangyImageThumb({
  name,
  src,
  status,
  error,
  onRemove,
  onRetry,
}: {
  name: string;
  /** The image to draw: the local file while it uploads, or the stored file once sent. */
  src?: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
  onRemove?: () => void;
  /** Shown on a failed upload that can be tried again. */
  onRetry?: () => void;
}) {
  const failed = status === "failed";
  const thumb = (
    <Box
      data-testid="langy-image-thumb"
      data-status={status}
      position="relative"
      width={failed ? "auto" : THUMB_SIZE}
      maxWidth="240px"
      height={THUMB_SIZE}
      flexShrink={0}
      borderRadius="10px"
      borderWidth="1px"
      borderStyle="solid"
      borderColor={failed ? "red.emphasized" : "border.emphasized"}
      background={failed ? "red.subtle" : "bg.muted"}
    >
      <ThumbFace name={name} src={src} failed={failed} error={error} onRetry={onRetry} />
      {status === "uploading" ? <UploadingVeil name={name} /> : null}
      {onRemove ? <RemoveImageButton name={name} onRemove={onRemove} /> : null}
    </Box>
  );
  if (failed || !src) return thumb;
  return (
    <Tooltip content={name} openDelay={300} showArrow>
      {thumb}
    </Tooltip>
  );
}
