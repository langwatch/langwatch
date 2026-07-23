import { Box, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";

import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { api } from "~/utils/api";

/**
 * The personal coding-agent usage figures (ADR-056, personal-usage.feature):
 * cost, tokens, active time and session count over the trailing window, with
 * what those sessions produced beneath. Reads the session aggregate, so a
 * session that sent only metrics is counted here too.
 *
 * A pure content component — the page wraps it in a titled card. It owns its
 * own load / empty / data states so the page doesn't branch on the query.
 */
export function CodingAgentUsageContent({ projectId }: { projectId: string }) {
  const query = api.codingAgents.usageTotals.useQuery(
    { projectId },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  if (query.isLoading) {
    return (
      <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height="64px" borderRadius="md" />
        ))}
      </SimpleGrid>
    );
  }

  if (query.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        Couldn&apos;t load coding-agent usage
      </Text>
    );
  }

  const totals = query.data;
  if (!totals || totals.sessionCount === 0) {
    return (
      <VStack align="start" gap={1}>
        <Text fontSize="sm" color="fg.muted">
          No coding-agent usage yet
        </Text>
        <Text fontSize="xs" color="fg.subtle">
          Run{" "}
          <Text as="code" fontSize="xs">
            langwatch claude
          </Text>{" "}
          to wire your coding agent&apos;s telemetry here.
        </Text>
      </VStack>
    );
  }

  const produced = [
    totals.linesAdded > 0 || totals.linesRemoved > 0
      ? `${numeral(totals.linesAdded).format("0,0")} added / ${numeral(
          totals.linesRemoved,
        ).format("0,0")} removed`
      : null,
    totals.commits > 0
      ? `${numeral(totals.commits).format("0,0")} commit${totals.commits === 1 ? "" : "s"}`
      : null,
    totals.pullRequests > 0
      ? `${numeral(totals.pullRequests).format("0,0")} PR${totals.pullRequests === 1 ? "" : "s"}`
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <VStack align="stretch" gap={3}>
      <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
        <Stat label="Sessions" value={numeral(totals.sessionCount).format("0,0")} />
        <Stat label="Cost" value={formatBudgetUsd(totals.costUsd)} />
        <Stat label="Tokens" value={formatTokens(totals.totalTokens)} />
        <Stat label="Active time" value={formatDuration(totals.activeTimeSec)} />
      </SimpleGrid>
      {produced.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          Produced: {produced.join(" · ")}
        </Text>
      )}
    </VStack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      backgroundColor="bg.subtle"
    >
      <Text
        fontSize="xs"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="semibold" marginTop={1}>
        {value}
      </Text>
    </Box>
  );
}

/** Compact token count: 999 → "999", 12_345 → "12.3k", 4_500_000 → "4.5m". */
function formatTokens(tokens: number): string {
  if (tokens < 1_000) return numeral(tokens).format("0,0");
  return numeral(tokens).format("0.[0]a");
}

/** Whole-second duration as "45s" / "12m" / "3h 20m". */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}
