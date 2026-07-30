import { Box, HoverCard, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
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
 *   - Verbose relative ("3 days ago") — dominant headline
 *   - Local / UTC / ISO as a tidy horizontal label→value grid
 *   - Day of week + IANA zone footer (supporting metadata)
 *
 * Read-only — the columns themselves (Time / Since / Timestamp) are the
 * format choice; the card surfaces every form at once, it doesn't switch
 * anything.
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
            width="296px"
            padding={0}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
            overflow="hidden"
            // Trap clicks/mousedown inside the popover so selecting
            // timestamp text to copy doesn't bubble up to the row's click
            // handler and open the trace drawer. The hover card sits over
            // the cell which is inside a clickable `<tr>` — without these
            // stop-prop handlers any interaction inside the card pops the
            // drawer open the moment the user lets go.
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
 * Body content. Hierarchy:
 *   1. Relative time — the dominant headline (why the user opened this)
 *   2. Local / UTC / ISO label→value grid (reference, secondary)
 *   3. Day-of-week + zone footer (quiet supporting metadata)
 *
 * The verbose-relative header re-renders precisely at the next minute /
 * hour / day boundary via `useVerboseRelativeTime` — no 1Hz polling.
 */
const TimeHoverCardBody: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const viewerZone = resolveViewerTimeZone();
  const relative = useVerboseRelativeTime(timestamp);
  const local = formatLocalWithZone(timestamp);
  const utc = formatAbsoluteTime(timestamp);
  const iso = formatISOTimestamp(timestamp);
  const dayOfWeek = formatDayOfWeek(timestamp);

  return (
    <VStack align="stretch" gap={0}>
      {/* ── 1. Relative time headline ─────────────────────────────── */}
      <Box paddingX={3} paddingTop={3} paddingBottom={2.5}>
        <Text
          textStyle="lg"
          fontWeight="semibold"
          color="fg"
          lineHeight="1.2"
          letterSpacing="-0.015em"
        >
          {relative}
        </Text>
      </Box>

      {/* ── 2. Label → value grid ─────────────────────────────────── */}
      <VStack
        align="stretch"
        gap={0}
        borderTopWidth="1px"
        borderColor="border.subtle"
        paddingX={3}
        paddingY={2.5}
      >
        <Row label="Local" value={local} />
        <Row label="UTC" value={utc} />
        <Row label="ISO" value={iso} mono />
      </VStack>

      {/* ── 3. Day-of-week + zone footer ──────────────────────────── */}
      <HStack
        gap={1.5}
        paddingX={3}
        paddingY={1.5}
        borderTopWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle"
      >
        {dayOfWeek && (
          <Text textStyle="2xs" color="fg.subtle">
            {dayOfWeek}
          </Text>
        )}
        {dayOfWeek && (
          <Box
            width="1px"
            height="9px"
            bg="border.muted"
            flexShrink={0}
            aria-hidden="true"
          />
        )}
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {viewerZone}
        </Text>
      </HStack>
    </VStack>
  );
};

/**
 * Single label→value row in the timestamp grid. The label sits in a
 * fixed-width column so all values left-align cleanly — this is the key
 * change from the old stacked-vertically style, which repeated the
 * ALL-CAPS micro-label treatment three times in a row and made the block
 * feel noisy. Horizontal alignment reads as a table, which is exactly
 * what it is.
 */
const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <HStack
    align="baseline"
    gap={3}
    paddingY={0.5}
    _notLast={{ borderBottomWidth: "1px", borderColor: "border.subtle" }}
  >
    <Text
      textStyle="2xs"
      color="fg.muted"
      fontWeight="500"
      width="32px"
      flexShrink={0}
    >
      {label}
    </Text>
    <Text
      textStyle="xs"
      color="fg"
      fontFamily={mono ? "mono" : undefined}
      lineHeight="1.6"
    >
      {value}
    </Text>
  </HStack>
);
