import { formatInstant } from "@langwatch/design-system/describe-instant";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import {
  Badge,
  Box,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { SsoConnectionHistoryEntry } from "@langwatch/enterprise-sso-contract";
import { currentTimeZone, nowInstant, Temporal } from "@langwatch/time";
import {
  Circle,
  CircleCheck,
  CircleMinus,
  Clock3,
  FileCheck2,
  Globe,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";

const EVENT_ICONS: Record<string, LucideIcon> = {
  "lw.identity.connection_registered": Plus,
  "lw.identity.domain_claimed": Globe,
  "lw.identity.domain_claim_approved": CircleCheck,
  "lw.identity.domain_claim_rejected": CircleMinus,
  "lw.identity.verification_requested": FileCheck2,
  "lw.identity.domain_verified": ShieldCheck,
  "lw.identity.domain_attested": ShieldCheck,
  "lw.identity.domain_withdrawn": CircleMinus,
  "lw.identity.domain_proof_wavered": Clock3,
  "lw.identity.domain_proof_lapsed": Clock3,
  "lw.identity.domain_proof_recovered": ShieldCheck,
  "lw.identity.connection_renamed": Pencil,
  "lw.identity.connection_activated": Play,
  "lw.identity.connection_resumed": Play,
  "lw.identity.connection_suspended": Pause,
  "lw.identity.connection_arrival_policy_set": Users,
  "lw.identity.connection_idp_updated": KeyRound,
  "lw.identity.connection_discarded": CircleMinus,
  "lw.identity.connection_torn_down": CircleMinus,
  "lw.identity.teardown_requested": CircleMinus,
  "lw.identity.replacement_connection_registered": Plus,
  "lw.identity.migration_route_selected": Settings2,
  "lw.identity.migration_finalization_started": Settings2,
  "lw.identity.migration_finalized": CircleCheck,
};

function historyDays({ entries }: { entries: SsoConnectionHistoryEntry[] }) {
  const timeZone = currentTimeZone();
  const today = nowInstant().toZonedDateTimeISO(timeZone).toPlainDate();
  const yesterday = today.subtract({ days: 1 });
  const days = new Map<string, { label: string; entries: SsoConnectionHistoryEntry[] }>();

  for (const entry of entries.toSorted((left, right) => right.occurredAtMs - left.occurredAtMs)) {
    const date = Temporal.Instant.fromEpochMilliseconds(entry.occurredAtMs)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
    const key = date.toString();
    let label = formatInstant({ epochMs: entry.occurredAtMs, display: "date", timeZone });
    if (date.equals(today)) label = "Today";
    if (date.equals(yesterday)) label = "Yesterday";
    const day = days.get(key);
    if (day) day.entries.push(entry);
    else days.set(key, { label, entries: [entry] });
  }

  return [...days.entries()];
}

export function ConnectionHistory({ connectionId }: { connectionId: string }) {
  const history = api.ssoConnections.getHistory.useQuery({ connectionId });
  const rows = history.data ?? [];
  const days = historyDays({ entries: rows });

  return (
    <Box
      as="section"
      aria-label="History"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={5}
    >
      <HStack justify="space-between" marginBottom={4}>
        <Heading as="h3" size="sm">
          History
        </Heading>
        <Text fontSize="xs" color="fg.muted">
          Newest first
        </Text>
      </HStack>
      {history.isLoading && <Skeleton height="16" />}
      {history.error && (
        <Text color="fg.error" fontSize="sm">
          This connection’s history could not be loaded.
        </Text>
      )}
      {!history.isLoading && !history.error && rows.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          Nothing has happened to this connection yet.
        </Text>
      )}
      <VStack align="stretch" gap={5}>
        {days.map(([key, day]) => (
          <Box key={key}>
            <Heading as="h4" size="xs" color="fg.muted" marginBottom={3}>
              {day.label}
            </Heading>
            <Box as="ol" listStyleType="none" margin={0} padding={0} aria-label={day.label}>
              {day.entries.map((entry, index) => (
                <HistoryEntry
                  key={entry.eventId}
                  entry={entry}
                  last={index === day.entries.length - 1}
                />
              ))}
            </Box>
          </Box>
        ))}
      </VStack>
    </Box>
  );
}

function HistoryEntry({ entry, last }: { entry: SsoConnectionHistoryEntry; last: boolean }) {
  const EventIcon = EVENT_ICONS[entry.eventType ?? ""] ?? Circle;

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
          <EventIcon size={14} />
        </Box>
        {!last && <Box width="1px" flex={1} bg="border.muted" marginY={1} />}
      </VStack>
      <Box minWidth={0} flex={1} paddingTop={0.5} paddingBottom={last ? 0 : 4}>
        <Text fontSize="sm" lineHeight="tall" overflowWrap="anywhere">
          {entry.summary}
        </Text>
        <HStack gap={2} marginTop={0.5} fontSize="xs" color="fg.muted" flexWrap="wrap">
          <FormattedDate value={entry.occurredAtMs} display="relative" />
          {entry.carriedOver && (
            <Badge colorPalette="gray" size="xs">
              Carried over
            </Badge>
          )}
        </HStack>
      </Box>
    </HStack>
  );
}
