// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import {
  Alert,
  Badge,
  SimpleGrid,
  Stat,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { SecurityLakeSourceHealth } from "@langwatch/enterprise-governance-contract";
import type { ReactNode } from "react";

type SourceHealth = SecurityLakeSourceHealth;

const formatTime = (ms: number | null): ReactNode =>
  ms === null ? "Not read yet" : <FormattedDate value={ms} />;

/** Lag in the largest unit that keeps it a whole number; a read that wrote nothing has none. */
function formatLag({ ms, lastReadAt }: { ms: number | null; lastReadAt: number | null }): string {
  if (lastReadAt === null) return "Not read yet";
  if (ms === null) return "No new events";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

/** What the reader folded from its runs: last read, lag, errors, counts and poison objects. */
export function SecurityLakeHealthPanel({ health }: { health: SourceHealth }) {
  const folded = health.health;
  const stats: { label: string; value: ReactNode }[] = [
    { label: "Last read", value: formatTime(folded.lastReadAt) },
    { label: "Lag", value: formatLag({ ms: folded.lagMs, lastReadAt: folded.lastReadAt }) },
    { label: "Objects read", value: String(folded.objects) },
    { label: "Events written", value: String(folded.written) },
    { label: "Events dropped", value: String(folded.dropped) },
    { label: "Invalid rows", value: String(folded.invalid) },
    { label: "Retries", value: String(folded.retried) },
    { label: "Poison objects", value: String(folded.poisonCount) },
  ];
  return (
    <VStack align="stretch" gap={4} aria-label="Security Lake source health">
      {health.lastError && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Title>Last run failed: {health.lastError}</Alert.Title>
        </Alert.Root>
      )}
      <SimpleGrid columns={{ base: 2, md: 4 }} gap={4}>
        {stats.map((stat) => (
          <Stat.Root key={stat.label}>
            <Stat.Label>{stat.label}</Stat.Label>
            <Stat.ValueText textStyle="lg" minWidth={0} overflowWrap="anywhere">
              {stat.value}
            </Stat.ValueText>
          </Stat.Root>
        ))}
      </SimpleGrid>
      {folded.poison.length > 0 && (
        <VStack align="stretch" gap={2}>
          <Text textStyle="sm" fontWeight="medium">
            Poison objects <Badge colorPalette="red">{folded.poisonCount}</Badge>
          </Text>
          <Table.Root size="sm" aria-label="Poison objects">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Object</Table.ColumnHeader>
                <Table.ColumnHeader>Reason</Table.ColumnHeader>
                <Table.ColumnHeader>When</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {folded.poison.map((entry) => (
                <Table.Row key={entry.messageId}>
                  <Table.Cell>{entry.key}</Table.Cell>
                  <Table.Cell>{entry.reason}</Table.Cell>
                  <Table.Cell>{formatTime(entry.at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </VStack>
      )}
    </VStack>
  );
}
