import { HStack, Skeleton, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { EventBadge } from "../../sharedChips";
import type { CellDef } from "../../types";

type Density = "compact" | "comfortable";

/**
 * Badges a row shows before collapsing the rest into a remainder chip. Three
 * fits the column's default width without wrapping; the chip carries the count
 * of what it stands for and names them on hover.
 */
const VISIBLE_BADGES = 3;

/**
 * The cell's four states, in the order it decides between them: pending while
 * the page's events are still coming, unavailable if they never did, the empty
 * marker for a trace that recorded none, and otherwise a badge per event name.
 * The first two exist so the empty marker only ever means "recorded nothing".
 */
function renderEvents({ row, density }: { row: TraceListItem; density: Density }) {
  const textStyle = density === "compact" ? "xs" : "sm";
  const { groups, distinctCount } = row.events;

  if (groups.length === 0) {
    // While the page's events are still in flight the row has no events yet
    // but may well have some — the empty marker would be a claim we can't
    // make, so hold the space instead.
    if (row.eventsLoading) {
      return <Skeleton height="16px" width="60px" borderRadius="md" />;
    }
    // Same reasoning once the read has failed: the trace may well have events
    // and we simply cannot say. The rest of the row is unaffected.
    if (row.eventsUnavailable) {
      return (
        <Text textStyle={textStyle} color="fg.subtle" title="Events could not be loaded">
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

  const shown = groups.slice(0, VISIBLE_BADGES);
  const hiddenCount = distinctCount - shown.length;
  const gap = density === "compact" ? 1 : 1.5;

  return (
    <HStack gap={gap} flexWrap="wrap">
      {shown.map((event) => (
        <EventBadge key={event.name} event={event} />
      ))}
      {hiddenCount > 0 && (
        <Text
          textStyle="2xs"
          fontWeight="medium"
          color="fg.muted"
          flexShrink={0}
          title={remainderTitle({
            remaining: groups.slice(VISIBLE_BADGES),
            hiddenCount,
          })}
        >
          +{hiddenCount}
        </Text>
      )}
    </HStack>
  );
}

/**
 * Names what the remainder chip stands for. The rollup itself is trimmed
 * server-side, so past that trim the chip can only report how many more there
 * were rather than pretend to name them.
 */
function remainderTitle({
  remaining,
  hiddenCount,
}: {
  remaining: { name: string }[];
  hiddenCount: number;
}): string {
  const named = remaining.map((event) => event.name);
  const unnamed = hiddenCount - named.length;
  if (unnamed > 0) named.push(`and ${unnamed.toLocaleString()} more`);
  return named.join(", ");
}

export const EventsCell = {
  id: "events",
  label: "Events",
  render: ({ row }) => renderEvents({ row, density: "compact" }),
  renderComfortable: ({ row }) => renderEvents({ row, density: "comfortable" }),
} as const satisfies CellDef<TraceListItem>;
