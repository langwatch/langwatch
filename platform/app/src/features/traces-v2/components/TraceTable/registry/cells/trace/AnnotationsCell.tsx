import { HStack, Skeleton, Text } from "@chakra-ui/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type React from "react";
import {
  AnnotationCommentsChip,
  AnnotationScoresChip,
  AnnotationSuggestionsChip,
} from "@langwatch/annotation-web";
import { useScoreNamesById } from "~/hooks/useScoreNamesById";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

type Density = "compact" | "comfortable";

/**
 * What reviewers left on the trace: a count per kind, each opening what was
 * written on hover. Counts rather than text because a page of traces has to
 * stay scannable, and one comment in full is taller than the whole row.
 *
 * The cell's states, in the order it decides between them: pending while the
 * page's annotations are still coming, unavailable when they cannot be read,
 * the empty marker for a trace nobody has reviewed, and otherwise the counts.
 * The first two exist so the empty marker only ever means "nobody reviewed it".
 */
const AnnotationsCellView: React.FC<{
  row: TraceListItem;
  density: Density;
}> = ({ row, density }) => {
  const textStyle = density === "compact" ? "xs" : "sm";
  const annotations = row.annotations ?? [];

  if (annotations.length === 0) {
    if (row.annotationsLoading) {
      return <Skeleton height="16px" width="48px" borderRadius="md" />;
    }
    if (row.annotationsUnavailable) {
      return (
        <Text
          textStyle={textStyle}
          color="fg.subtle"
          title="Annotations could not be loaded"
        >
          Unavailable
        </Text>
      );
    }
    return (
      <Text textStyle={textStyle} color="fg.subtle">
        —
      </Text>
    );
  }

  return <AnnotationCounts row={row} density={density} />;
};

/**
 * The counts themselves. Split out so the project's score names are only
 * looked up for the rows that carry a review, rather than for every row of a
 * page where most traces have none.
 */
const AnnotationCounts: React.FC<{ row: TraceListItem; density: Density }> = ({
  row,
  density,
}) => {
  const scoreNamesById = useScoreNamesById();
  const annotations = row.annotations ?? [];
  const thumbsUp = annotations.filter((a) => a.isThumbsUp === true).length;
  const thumbsDown = annotations.filter((a) => a.isThumbsUp === false).length;

  return (
    <HStack gap={density === "compact" ? 1 : 1.5} flexWrap="wrap">
      <AnnotationCommentsChip annotations={annotations} traceId={row.traceId} />
      <AnnotationSuggestionsChip annotations={annotations} traceId={row.traceId} />
      <AnnotationScoresChip
        annotations={annotations}
        traceId={row.traceId}
        scoreNamesById={scoreNamesById}
      />
      <ThumbsCount count={thumbsUp} verdict="up" />
      <ThumbsCount count={thumbsDown} verdict="down" />
    </HStack>
  );
};

/**
 * How many reviewers rated the trace one way. A rating is the whole of some
 * reviews, so without it a row where everyone only rated would read as if
 * nobody had looked at the trace.
 */
const ThumbsCount: React.FC<{ count: number; verdict: "up" | "down" }> = ({
  count,
  verdict,
}) => {
  if (count === 0) return null;
  const label = `${count} thumbs ${verdict}`;
  const Icon = verdict === "up" ? ThumbsUp : ThumbsDown;

  return (
    <HStack
      as="span"
      gap={1}
      paddingX={2}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.muted"
      background="bg.muted"
      width="fit-content"
      color={verdict === "up" ? "green.fg" : "red.fg"}
      data-testid={`annotation-thumbs-${verdict}-chip`}
      aria-label={label}
      title={label}
    >
      <Icon size={12} />
      <Text textStyle="xs" fontWeight="medium" color="fg">
        {count}
      </Text>
    </HStack>
  );
};

export const AnnotationsCell = {
  id: "annotations",
  label: "Annotations",
  render: ({ row }) => <AnnotationsCellView row={row} density="compact" />,
  renderComfortable: ({ row }) => <AnnotationsCellView row={row} density="comfortable" />,
} as const satisfies CellDef<TraceListItem>;
