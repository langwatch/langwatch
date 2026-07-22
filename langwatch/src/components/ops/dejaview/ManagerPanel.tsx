import { Box, Text, VStack } from "@chakra-ui/react";

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
  if (query.isLoading || managers.length === 0) return null;

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
      <VStack align="stretch" gap={3} padding={3}>
        {managers.map((manager) => (
          <ManagerCard key={manager.processName} manager={manager} />
        ))}
      </VStack>
    </Box>
  );
}
