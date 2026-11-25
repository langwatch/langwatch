import { Box, chakra, Spinner, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { CircleAlert, Image as ImageIcon, X } from "lucide-react";

const THUMB_SIZE = "52px";

function ThumbFace({
  name,
  src,
  failed,
  error,
}: {
  name: string;
  src?: string;
  failed: boolean;
  error?: string;
}) {
  if (failed) {
    return (
      <Box display="flex" alignItems="center" gap={2} height="full" paddingX={2.5} color="red.fg">
        <CircleAlert size={15} aria-hidden />
        <Box minWidth={0}>
          <Text textStyle="xs" fontWeight="medium" truncate>
            {name}
          </Text>
          <Text textStyle="2xs" truncate>
            {error ?? "Couldn't attach this image"}
          </Text>
        </Box>
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

/** An image in the row above the composer's text: its thumbnail, upload state and remove button. */
export function LangyImageThumb({
  name,
  src,
  status,
  error,
  onRemove,
}: {
  name: string;
  /** The image to draw: the local file while it uploads, or the stored file once sent. */
  src?: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
  onRemove?: () => void;
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
      <ThumbFace name={name} src={src} failed={failed} error={error} />
      {status === "uploading" ? (
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
      ) : null}
      {onRemove ? (
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
      ) : null}
    </Box>
  );
  if (failed || !src) return thumb;
  return (
    <Tooltip content={name} openDelay={300} showArrow>
      {thumb}
    </Tooltip>
  );
}
