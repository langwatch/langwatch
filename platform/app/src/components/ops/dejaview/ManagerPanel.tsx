import { Box, Text, VStack } from "@chakra-ui/react";

import { describeError } from "~/features/errors";
import { api } from "~/utils/api";

import { ManagerCard } from "./ManagerCard";

/**
 * The process-manager state machines for the aggregate on screen: each machine
 * with its definition and this aggregate's current position (state, revision,
 * next wake) plus the commands it has emitted.
 *
 * Only per-aggregate machines apply, so most aggregate types have none — the
 * panel collapses entirely rather than take a column when there is nothing to
 * show.
 */
export function ManagerPanel({
  aggregateType,
  tenantId,
  aggregateId,
}: {
  aggregateType: string;
  tenantId: string;
  aggregateId: string;
}) {
  const query = api.ops.getAggregateProcessManagers.useQuery(
    { aggregateType, tenantId, aggregateId },
    {
      enabled: !!aggregateType && !!tenantId && !!aggregateId,
      refetchInterval: 15_000,
    },
  );

  const managers = query.data ?? [];
  if (query.isLoading) return null;
  // A failed fetch must not collapse the panel the way "no managers" does —
  // this is a debugging tool, so its own failures have to be visible.
  if (!query.error && managers.length === 0) return null;

  return (
    <Box
      width="360px"
      minWidth="360px"
      borderLeft="1px solid"
      borderLeftColor="border"
      overflowY="auto"
      bg="bg.surface"
    >
      <Box
        paddingX={3}
        paddingY={2}
        borderBottom="1px solid"
        borderBottomColor="border"
      >
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          Process Managers
        </Text>
      </Box>
      {query.error ? (
        <Box paddingX={3} paddingY={4}>
          {/* One `Text`, so the registry's sentence reads as one sentence. The
              old inline `error.message` rendered "Could not load process
              managers: clickhouse_unavailable" — a slug, since #5984. */}
          <Text textStyle="xs" color="red.solid">
            {describeError({
              error: query.error,
              fallbackTitle: "Could not load process managers",
            })}
          </Text>
        </Box>
      ) : (
        <VStack align="stretch" gap={3} padding={3}>
          {managers.map((manager) => (
            <ManagerCard key={manager.processName} manager={manager} />
          ))}
        </VStack>
      )}
    </Box>
  );
}
