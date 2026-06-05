import {
  Box,
  HoverCard,
  HStack,
  Portal,
  SegmentGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { useTimeColumnModeStore } from "../../../../../stores/timeColumnModeStore";
import {
  formatAbsoluteTime,
  formatDayOfWeek,
  formatISOTimestamp,
  formatLocalWithZone,
  resolveViewerTimeZone,
} from "../../../../../utils/formatters";
import { useVerboseRelativeTime } from "../../../../../utils/useRelativeTime";

/**
 * Shared hover popover for the TIME / SINCE / TIMESTAMP columns. Surfaces
 * the same timestamp through every useful lens so users don't have to
 * switch columns to see "how long ago" vs "wall-clock" vs "ISO for log
 * queries":
 *
 *   - Verbose relative ("3 days ago")
 *   - Local time with the viewer's tz abbreviation
 *   - UTC ("…UTC" suffix; matches what server logs render)
 *   - ISO 8601 (copy-pasteable)
 *   - Day of week + IANA zone footer
 *
 * Modelled on `TracePreviewHoverCard` so it inherits the same open/close
 * delay + portal/positioner contract. Children render as the trigger;
 * `placement` defaults to bottom-start because most time cells live in
 * the leftmost column.
 */
interface TimeHoverCardProps {
  timestamp: number;
  children: React.ReactNode;
  placement?:
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end";
}

export const TimeHoverCard: React.FC<TimeHoverCardProps> = ({
  timestamp,
  children,
  placement = "bottom-start",
}) => {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard.Root
      open={open}
      openDelay={250}
      closeDelay={150}
      positioning={{ placement }}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
    >
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="320px"
            padding={3}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
            // Trap clicks/mousedown inside the popover so toggling the
            // time-column mode (or selecting timestamp text to copy)
            // doesn't bubble up to the row's click handler and open the
            // trace drawer. The hover card sits over the cell which is
            // inside a clickable `<tr>` — without these stop-prop
            // handlers any interaction inside the card pops the drawer
            // open the moment the user lets go.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <TimeHoverCardBody timestamp={timestamp} />
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

/**
 * Body content. The verbose-relative header re-renders precisely at
 * the next minute / hour / day boundary via `useVerboseRelativeTime`
 * — no 1Hz polling. A footer toggles the source time column between
 * "Since" (relative) and "Sum" (absolute) display modes so the user
 * doesn't have to leave the popover to change how the column reads.
 */
const TimeHoverCardBody: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const viewerZone = resolveViewerTimeZone();
  const relative = useVerboseRelativeTime(timestamp);
  const local = formatLocalWithZone(timestamp);
  const utc = formatAbsoluteTime(timestamp);
  const iso = formatISOTimestamp(timestamp);
  const dayOfWeek = formatDayOfWeek(timestamp);

  const mode = useTimeColumnModeStore((s) => s.mode);
  const setMode = useTimeColumnModeStore((s) => s.setMode);

  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="md" fontWeight="semibold" color="fg">
        {relative}
      </Text>
      <Row label="Local" value={local} />
      <Row label="UTC" value={utc} />
      <Row label="ISO" value={iso} mono />
      <HStack
        gap={2}
        paddingTop={1}
        borderTopWidth="1px"
        borderColor="border.subtle"
      >
        <Text textStyle="2xs" color="fg.muted">
          {dayOfWeek}
        </Text>
        {dayOfWeek && (
          <Box width="1px" height="10px" bg="border.muted" aria-hidden="true" />
        )}
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {viewerZone}
        </Text>
      </HStack>
      {/* In-popover toggle for the column's display mode. The "Since"
          column shows relative time ("4m"); the "Sum" column shows the
          absolute timestamp ("Jun 4 18:32"). Audit feedback was that
          users didn't realise this was a column choice — surfacing the
          switch right under the timestamps they're looking at gives
          them the click without having to dig into Columns settings.
          Persisted to localStorage so the choice survives reloads. */}
      <VStack
        align="stretch"
        gap={1}
        paddingTop={2}
        borderTopWidth="1px"
        borderColor="border.subtle"
      >
        <Text
          textStyle="2xs"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          Column shows
        </Text>
        <SegmentGroup.Root
          size="xs"
          value={mode}
          onValueChange={(e) =>
            setMode(e.value === "absolute" ? "absolute" : "relative")
          }
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items
            items={[
              { value: "relative", label: "Since (4m ago)" },
              { value: "absolute", label: "Sum (Jun 4 18:32)" },
            ]}
          />
        </SegmentGroup.Root>
      </VStack>
    </VStack>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <VStack align="stretch" gap={0.5}>
    <Text
      textStyle="2xs"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="0.06em"
    >
      {label}
    </Text>
    <Text textStyle="xs" color="fg" fontFamily={mono ? "mono" : undefined}>
      {value}
    </Text>
  </VStack>
);
