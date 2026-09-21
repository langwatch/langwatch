// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What has happened to this connection, read straight off its event history
 * (ADR-117 §5, D04) — registered, a domain claimed and proved, activated,
 * suspended — newest first. A READ, permanently: a history a viewer could
 * edit would not be one. Every word comes from the server, so no reader ever
 * meets an internal event name.
 */
import { Badge, Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { nowInstant, toDate, Temporal } from "@langwatch/time";

import { ssoApi } from "../../behavior/sso-api.ts";
import { groupHistoryByDay, type HistoryDayEntry } from "../../model/history-days.ts";
import { SettingsCard } from "../elements/settings-card.tsx";

/**
 * `tabular-nums` with two-digit fields fixes both the character count and
 * width, which is what lines a column of times up without a guessed
 * `minWidth`. The reader's locale still decides how it is written.
 */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

export function HistorySection({
  organizationId,
  connectionId,
}: {
  organizationId: string;
  connectionId: string;
}) {
  const history = ssoApi.ssoSetup.getHistory.useQuery({ organizationId, connectionId });

  const rows = history.data ?? [];
  // Read at render: "Today" and "Yesterday" are facts about when the page is
  // being looked at, not about the events.
  const days = groupHistoryByDay({ entries: rows, nowMs: nowInstant().epochMilliseconds });

  return (
    <SettingsCard
      title="Event log"
      hint="What happened to this connection, newest first."
      testId="connection-history"
    >
      {history.isLoading && <Skeleton height="16px" width="60%" />}

      {/* A read that failed is not a connection with no history: showing the
          empty state tells the reader nothing ever happened when we simply
          could not find out. */}
      {history.isError && (
        <Text fontSize="xs" color="fg.error">
          This connection&apos;s history could not be loaded.
        </Text>
      )}

      {!history.isLoading && !history.isError && rows.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          Nothing has happened to this connection yet.
        </Text>
      )}

      <VStack align="stretch" gap={3}>
        {days.map((day) => (
          <Box key={day.key}>
            <Text
              fontSize="11.5px"
              fontWeight="600"
              color="fg.muted"
              paddingBottom={1.5}
              data-testid="connection-history-day"
            >
              {day.label}
            </Text>
            <VStack align="stretch" gap={0}>
              {day.entries.map((entry, index) => (
                <HistoryRow
                  key={entry.eventId}
                  entry={entry}
                  last={index === day.entries.length - 1}
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </SettingsCard>
  );
}

/**
 * One thing that happened, on a rail: a dot per event and a hairline joining
 * them, which is what turns a list of sentences into a sequence. Decoration
 * over the order the rows already have, so it is hidden from a reader who is
 * being read to.
 */
function HistoryRow({ entry, last }: { entry: HistoryDayEntry; last: boolean }) {
  return (
    <HStack gap={3} align="stretch" data-testid="connection-history-entry">
      <VStack gap={0} width="7px" flexShrink={0} paddingTop="7px" aria-hidden="true">
        <Box
          width="7px"
          height="7px"
          borderRadius="full"
          background="border.emphasized"
          flexShrink={0}
        />
        {!last && <Box flex={1} width="1px" background="border.muted" />}
      </VStack>
      <HStack gap={3} align="start" paddingBottom={last ? 0 : 2.5} minWidth={0} flex={1}>
        <Text
          fontSize="11.5px"
          color="fg.muted"
          flexShrink={0}
          whiteSpace="nowrap"
          fontVariantNumeric="tabular-nums"
          lineHeight="1.5"
        >
          {toDate(Temporal.Instant.fromEpochMilliseconds(entry.occurredAtMs)).toLocaleTimeString(
            undefined,
            TIME_FORMAT,
          )}
        </Text>
        <Text fontSize="13px" lineHeight="1.5" minWidth={0}>
          {entry.summary}
        </Text>
        {/* Named rather than hidden: the weaker evidence an earlier
            configuration carried must never become invisible (D05). */}
        {entry.carriedOver && (
          <Badge size="sm" colorPalette="gray" title="From your earlier configuration">
            Carried over
          </Badge>
        )}
      </HStack>
    </HStack>
  );
}
