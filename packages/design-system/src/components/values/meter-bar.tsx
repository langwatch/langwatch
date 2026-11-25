import { Box } from "@chakra-ui/react";

/** One part of a segmented meter: its share of the track, 0 to 1, and its colour token. */
export interface MeterSegment {
  ratio: number;
  color: string;
}

interface MeterBarFrame {
  width: string;
  height: string;
  /** Edge the fill grows from. Right-aligned columns read better as "end". */
  align?: "start" | "end";
  /** Forwarded to the track so callers can label or test it. */
  "data-testid"?: string;
}

interface SingleFill {
  /**
   * How much of the track to fill, 0 to 1. Values above 1 clamp to a full
   * track. `null` renders the bare track: there is a slot for a reading,
   * but no reading to show, which is a different statement from zero.
   */
  fillRatio: number | null;
  /** Color token for the fill, e.g. "blue.fg" or "green.solid". */
  fillColor: string;
  segments?: never;
}

interface SegmentedFill {
  /** Parts laid end to end, e.g. "every" then "some"; together they clamp to a full track. */
  segments: readonly MeterSegment[];
  fillRatio?: never;
  fillColor?: never;
}

export type MeterBarProps = MeterBarFrame & (SingleFill | SegmentedFill);

/** Clamps each part so the parts together never pass the end of the track. */
function clampSegments(segments: readonly MeterSegment[]): MeterSegment[] {
  let left = 1;
  return segments.flatMap((segment) => {
    const ratio = Math.min(Math.max(segment.ratio, 0), left);
    left -= ratio;
    return ratio > 0 ? [{ ratio, color: segment.color }] : [];
  });
}

/**
 * A thin rounded meter: one value, or a few parts of one whole, against the width it is measured
 * in. Shared by the trace table's latency columns, the virtual-keys budget bar and the usage
 * cards as one object.
 */
export function MeterBar(props: MeterBarProps) {
  const { width, height, align = "start", "data-testid": testId } = props;
  const parts = props.segments
    ? clampSegments(props.segments)
    : clampSegments([{ ratio: props.fillRatio ?? 0, color: props.fillColor }]);
  const segmented = Boolean(props.segments);
  return (
    <Box
      width={width}
      height={height}
      bg="border.subtle"
      borderRadius="full"
      overflow={segmented ? "hidden" : undefined}
      display="flex"
      justifyContent={align === "end" ? "flex-end" : "flex-start"}
      data-testid={testId}
    >
      {parts.map((part, index) => (
        <Box
          // Parts never reorder, so the index is a stable key.
          key={index}
          height="full"
          width={`${part.ratio * 100}%`}
          // The clamped ratio, readable without resolving styling: reading the width back would
          // depend on whether the styling layer inlines the value or emits a class.
          data-fill-ratio={part.ratio}
          bg={part.color}
          borderRadius={segmented ? undefined : "full"}
        />
      ))}
    </Box>
  );
}
