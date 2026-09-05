import { Box } from "@chakra-ui/react";

export interface MeterBarProps {
  /**
   * How much of the track to fill, 0 to 1. Values above 1 clamp to a full
   * track. `null` renders the bare track: there is a slot for a reading,
   * but no reading to show, which is a different statement from zero.
   */
  fillRatio: number | null;
  width: string;
  height: string;
  /** Color token for the fill, e.g. "blue.fg" or "green.solid". */
  fillColor: string;
  /** Edge the fill grows from. Right-aligned columns read better as "end". */
  align?: "start" | "end";
  /** Forwarded to the track so callers can label or test it. */
  "data-testid"?: string;
}

/**
 * A thin rounded meter: one value against the width it is measured in.
 */
export function MeterBar({
  fillRatio,
  width,
  height,
  fillColor,
  align = "start",
  "data-testid": testId,
}: MeterBarProps) {
  return (
    <Box
      width={width}
      height={height}
      bg="border.subtle"
      borderRadius="full"
      display="flex"
      justifyContent={align === "end" ? "flex-end" : "flex-start"}
      data-testid={testId}
    >
      {fillRatio !== null && fillRatio > 0 && (
        <Box
          height="full"
          width={`${Math.min(fillRatio, 1) * 100}%`}
          // The clamped ratio, readable without resolving styling. The width
          // above is the same number, but reading it back means depending on
          // whether the styling layer inlines the value or emits a class.
          data-fill-ratio={Math.min(fillRatio, 1)}
          bg={fillColor}
          borderRadius="full"
        />
      )}
    </Box>
  );
}
