import {
  Box,
  HoverCard,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  formatAbsoluteTime,
  formatDayOfWeek,
  formatISOTimestamp,
  formatLocalWithZone,
  formatVerboseRelative,
  resolveViewerTimeZone,
} from "../../../../../utils/formatters";

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
          >
            <TimeHoverCardBody timestamp={timestamp} />
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

/**
 * Body content. Separated so the values can re-tick the "relative" line
 * once a second without re-mounting the popover chrome.
 */
const TimeHoverCardBody: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  // The verbose-relative line ticks on its own so a popover that's been
  // open through a minute boundary shows "2 minutes ago" instead of
  // staying at "1 minute ago". 5s cadence is plenty — popover is
  // ephemeral, no one watches it for a minute straight.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  const viewerZone = resolveViewerTimeZone();
  const relative = formatVerboseRelative(timestamp);
  const local = formatLocalWithZone(timestamp);
  const utc = formatAbsoluteTime(timestamp);
  const iso = formatISOTimestamp(timestamp);
  const dayOfWeek = formatDayOfWeek(timestamp);

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
