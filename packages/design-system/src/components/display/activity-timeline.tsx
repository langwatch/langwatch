import { Box, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { currentTimeZone, nowInstant, Temporal } from "@langwatch/time";
import { Circle } from "lucide-react";
import type { ReactNode } from "react";

import { formatInstant } from "../../describe-instant.ts";
import { FormattedDate } from "../values/formatted-date.tsx";

export interface ActivityTimelineEntry {
  id: string;
  occurredAtMs: number;
  content: ReactNode;
  /** Decorative event icon; event-kind mapping belongs to the feature. */
  icon?: ReactNode;
  meta?: ReactNode;
}

export interface ActivityTimelineProps {
  entries: readonly ActivityTimelineEntry[];
  title?: string;
  /** May also contain the host's loading or error presentation. */
  emptyState?: ReactNode;
  timeZone?: string;
  locale?: string;
}

function groupDays({ entries, timeZone, locale }: ActivityTimelineProps & { timeZone: string }) {
  const today = nowInstant().toZonedDateTimeISO(timeZone).toPlainDate();
  const yesterday = today.subtract({ days: 1 });
  const days = new Map<string, { label: string; entries: ActivityTimelineEntry[] }>();

  for (const entry of entries.toSorted((left, right) => right.occurredAtMs - left.occurredAtMs)) {
    const date = Temporal.Instant.fromEpochMilliseconds(entry.occurredAtMs)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
    const key = date.toString();
    let label = formatInstant({ epochMs: entry.occurredAtMs, display: "date", timeZone, locale });
    if (date.equals(today)) label = "Today";
    if (date.equals(yesterday)) label = "Yesterday";
    const day = days.get(key);
    if (day) day.entries.push(entry);
    else days.set(key, { label, entries: [entry] });
  }

  return [...days.entries()];
}

/** Newest-first activity grouped by the viewer's calendar day, with exact-time hovers. */
export function ActivityTimeline({
  entries,
  title = "Activity",
  emptyState = "No activity yet.",
  timeZone = currentTimeZone(),
  locale,
}: ActivityTimelineProps) {
  const days = groupDays({ entries, timeZone, locale });

  return (
    <>
      <HStack justify="space-between" marginBottom={4}>
        <Heading as="h3" size="sm">
          {title}
        </Heading>
        <Text fontSize="xs" color="fg.muted">
          Newest first
        </Text>
      </HStack>
      {entries.length === 0 && (
        <Box color="fg.muted" fontSize="sm">
          {emptyState}
        </Box>
      )}
      <VStack align="stretch" gap={5}>
        {days.map(([key, day]) => (
          <Box key={key}>
            <Heading as="h4" size="xs" color="fg.muted" marginBottom={3}>
              {day.label}
            </Heading>
            <Box as="ol" listStyleType="none" margin={0} padding={0} aria-label={day.label}>
              {day.entries.map((entry, index) => (
                <ActivityItem
                  key={entry.id}
                  entry={entry}
                  last={index === day.entries.length - 1}
                  timeZone={timeZone}
                  locale={locale}
                />
              ))}
            </Box>
          </Box>
        ))}
      </VStack>
    </>
  );
}

function ActivityItem({
  entry,
  last,
  timeZone,
  locale,
}: {
  entry: ActivityTimelineEntry;
  last: boolean;
  timeZone: string;
  locale?: string;
}) {
  return (
    <HStack as="li" gap={3} align="stretch">
      <VStack gap={0} width="7" flexShrink={0} aria-hidden>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize="7"
          borderRadius="full"
          bg="bg.muted"
          color="fg.muted"
        >
          {entry.icon ?? <Circle size={14} />}
        </Box>
        {!last && <Box width="1px" flex={1} bg="border.muted" marginY={1} />}
      </VStack>
      <Box minWidth={0} flex={1} paddingTop={0.5} paddingBottom={last ? 0 : 4}>
        <Text fontSize="sm" lineHeight="tall" overflowWrap="anywhere">
          {entry.content}
        </Text>
        <HStack gap={2} marginTop={0.5} fontSize="xs" color="fg.muted" flexWrap="wrap">
          <FormattedDate
            value={entry.occurredAtMs}
            display="relative"
            timeZone={timeZone}
            locale={locale}
          />
          {entry.meta}
        </HStack>
      </Box>
    </HStack>
  );
}
