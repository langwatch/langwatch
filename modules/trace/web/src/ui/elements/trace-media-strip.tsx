import { Text, VStack } from "@chakra-ui/react";
import { Fragment, type ReactNode } from "react";

export type TraceMediaPartData =
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

export const MAX_RENDERED_MEDIA_PARTS = 8;

export type TraceMediaStripProps = {
  parts: TraceMediaPartData[];
  renderPart: (part: TraceMediaPartData) => ReactNode;
};

/**
 * Shows a bounded preview of media embedded in a trace input or output.
 * Rendering the concrete media widget remains an app concern because it
 * needs the app's project and stored-object services.
 */
export function TraceMediaStrip({ parts, renderPart }: TraceMediaStripProps) {
  if (parts.length === 0) {
    return null;
  }

  const visible = parts.slice(0, MAX_RENDERED_MEDIA_PARTS);
  const hidden = parts.length - visible.length;

  return (
    <VStack align="flex-start" gap={2} marginBottom={2}>
      {visible.map((part, index) => (
        <Fragment key={`trace-media-${index}`}>{renderPart(part)}</Fragment>
      ))}
      {hidden > 0 && (
        <Text fontSize="xs" color="fg.muted" data-testid="trace-media-overflow">
          +{hidden} more media {hidden === 1 ? "item" : "items"} not shown
        </Text>
      )}
    </VStack>
  );
}
