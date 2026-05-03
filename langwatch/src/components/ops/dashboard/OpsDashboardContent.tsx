import { useMemo } from "react";
import { VStack } from "@chakra-ui/react";
import type { DashboardData } from "~/server/app-layer/ops/types";
import type { ConnectionStatus } from "~/hooks/useOpsSSE";
import { api } from "~/utils/api";
import { ActiveOperationsSection } from "./ActiveOperationsSection";
import { PipelineTreeCard } from "~/components/ops/queues/PipelineTreeCard";
import { BlockedCard } from "~/components/ops/queues/BlockedCard";
import { DlqCard } from "~/components/ops/queues/DlqCard";
import { PendingTasksCard } from "~/components/ops/queues/PendingTasksCard";

export function OpsDashboardContent({
  data,
  connectionStatus,
}: {
  data: DashboardData;
  connectionStatus: ConnectionStatus;
}) {
  const queuesQuery = api.ops.listQueues.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const queueNames = useMemo(
    () => (queuesQuery.data ?? []).map((q) => q.name),
    [queuesQuery.data],
  );

  return (
    <VStack align="stretch" gap={4} width="full">
      <ActiveOperationsSection data={data} />
      <PendingTasksCard
        queueNames={queueNames}
        data={data}
        connectionStatus={connectionStatus}
      />
      <PipelineTreeCard
        pipelineTree={data.pipelineTree}
        pausedKeys={data.pausedKeys}
        queueNames={queueNames}
      />
      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
    </VStack>
  );
}
