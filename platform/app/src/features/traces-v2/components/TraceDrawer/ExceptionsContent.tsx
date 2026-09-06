import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { LuCircleX } from "react-icons/lu";
import type { ErrorSpanRanked } from "../../utils/errorSpans";

interface ExceptionsContentProps {
  /** Trace-level error message rolled up from the failing span(s). */
  error: string | null | undefined;
  /** Spans flagged with status=error, deepest-first (use `rankedErrorSpans`). */
  errorSpans: ErrorSpanRanked[];
  /** Click handler for a span pill — jumps the drawer to that span. */
  onSelectSpan?: (spanId: string) => void;
  /**
   * Optional sibling-callback fired alongside `onSelectSpan` so the
   * Exceptions section pulses + scrolls into view when the operator
   * jumps via a pill. The chip popover wires this to re-fire the
   * header chip's focus pipeline; the accordion-embedded variant wires
   * it to re-pulse the section the operator is already viewing so the
   * eye lands back on the row that owns the selected span.
   */
  onFocusSection?: () => void;
  /**
   * Compact mode tightens paddings + truncation widths so the same
   * block fits comfortably inside a hover popover. The full-size
   * variant is what the Exceptions accordion uses inline.
   */
  density?: "comfortable" | "compact";
  /** Optional element rendered above the message block (e.g. a "preview" hint). */
  header?: ReactNode;
}

/**
 * Shared visual for the trace-level error summary + per-span jump
 * buttons. The trace drawer surfaces this block in two places:
 *
 *   1. The `Exceptions` accordion on the Summary tab (comfortable).
 *   2. A hover popover anchored to the header `Error` chip (compact).
 *
 * Keeping the two paths in one component means the popover stays in
 * lockstep with the accordion: the same span ordering, the same red
 * tone, the same chip shape. A second customer report that "the
 * header link doesn't take me anywhere useful" stops being plausible
 * once both surfaces share rendering.
 */
export function ExceptionsContent({
  error,
  errorSpans,
  onSelectSpan,
  onFocusSection,
  density = "comfortable",
  header,
}: ExceptionsContentProps) {
  const isCompact = density === "compact";
  const spanNameMaxWidth = isCompact ? "160px" : "220px";
  return (
    <VStack align="stretch" gap={isCompact ? 1.5 : 2}>
      {header}
      {error && (
        <HStack
          gap={2}
          paddingX={isCompact ? 2 : 3}
          paddingY={isCompact ? 1.5 : 2}
          borderRadius="sm"
          bg="red.subtle"
          align="flex-start"
        >
          <Icon
            as={LuCircleX}
            boxSize={isCompact ? 3.5 : 4}
            color="red.fg"
            flexShrink={0}
            marginTop={0.5}
          />
          <Text
            textStyle="xs"
            color="red.fg"
            whiteSpace="pre-wrap"
            maxHeight={isCompact ? "5lh" : undefined}
            overflow={isCompact ? "hidden" : undefined}
          >
            {error}
          </Text>
        </HStack>
      )}
      {errorSpans.length > 0 && (
        <HStack gap={1.5} flexWrap="wrap" align="center">
          <Text
            textStyle="2xs"
            color="fg.muted"
            textTransform="uppercase"
            letterSpacing="0.04em"
          >
            Spans with errors
          </Text>
          {errorSpans.map(({ span }) => (
            <Button
              key={span.spanId}
              size="2xs"
              variant="outline"
              colorPalette="red"
              onClick={(e) => {
                // Stop propagation so the popover's outer hover/click
                // capture (which would dismiss it before the handler
                // ran) doesn't swallow the jump request.
                e.stopPropagation();
                onSelectSpan?.(span.spanId);
                onFocusSection?.();
              }}
              paddingX={2}
              height="22px"
              fontWeight="medium"
            >
              <Text truncate maxWidth={spanNameMaxWidth}>
                {span.name}
              </Text>
            </Button>
          ))}
        </HStack>
      )}
    </VStack>
  );
}
