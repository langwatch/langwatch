import { Text, VStack } from "@chakra-ui/react";
import type { MediaPartData } from "~/shared/traces/mediaParts";
import { TraceMediaPart } from "./TraceMediaPart";

/**
 * A collected list can be arbitrarily large (a 400-turn realtime voice trace
 * is 400 audio parts) and every part mounts a real element — hundreds of
 * <audio> tags stall the drawer. The strip mounts a preview-sized slice and
 * says how much more there is; the full content remains in the raw view.
 */
export const MAX_RENDERED_MEDIA_PARTS = 8;

/**
 * Vertical strip of media widgets (players, images, attachment chips) for a
 * collected part list, capped at `MAX_RENDERED_MEDIA_PARTS`. Renders nothing
 * for an empty list.
 */
export function TraceMediaStrip({ parts }: { parts: MediaPartData[] }) {
  if (parts.length === 0) return null;
  const visible = parts.slice(0, MAX_RENDERED_MEDIA_PARTS);
  const hidden = parts.length - visible.length;
  return (
    <VStack align="flex-start" gap={2} marginBottom={2}>
      {visible.map((part, i) => (
        <TraceMediaPart key={`trace-media-${i}`} part={part} />
      ))}
      {hidden > 0 && (
        <Text fontSize="xs" color="fg.muted" data-testid="trace-media-overflow">
          +{hidden} more media {hidden === 1 ? "item" : "items"} in the raw
          content below
        </Text>
      )}
    </VStack>
  );
}
