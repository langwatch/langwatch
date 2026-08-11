import { Card, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { AnomaliesCard } from "~/components/ops/queues/AnomaliesCard";
import { BlockedCard } from "~/components/ops/queues/BlockedCard";
import { DlqCard } from "~/components/ops/queues/DlqCard";
import { GroupsCard } from "~/components/ops/queues/GroupsCard";
import { PipelineTreeCard } from "~/components/ops/queues/PipelineTreeCard";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { ActiveOperationsSection } from "./ActiveOperationsSection";
import { HealthLine } from "./HealthLine";
import { ParkedCard } from "./ParkedCard";
import { ReplayHistorySection } from "./ReplayHistorySection";
import { StatStrip } from "./StatStrip";
import { ThroughputChart } from "./ThroughputChart";
import { TopErrorsCard } from "./TopErrorsCard";

/**
 * The ops landing page, read top to bottom as strip → health → chart →
 * structure → detail (dev/docs/best_practices/ops-dashboard.md).
 *
 * Space is proportional to trouble: an all-clear health state is one line, a
 * problem expands in place, and anything that explains a headline number sits
 * above the detail tables rather than below them.
 */
export function OpsDashboardContent({ data }: { data: DashboardData }) {
  const queuesQuery = api.ops.listQueues.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const queueNames = useMemo(
    () => (queuesQuery.data ?? []).map((q) => q.name),
    [queuesQuery.data],
  );

  // Read here as well as in AnomaliesCard so the health line can collapse both
  // all-clear states into one row. React Query serves both from one fetch.
  const anomaliesQuery = api.ops.listAnomalies.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  // "We could not check" is not "all clear". Until this query has actually
  // answered, the health line must not claim anomalies are clear — collapsing
  // an unknown into a green line is how an operator gets told nothing is wrong
  // during the exact incident that broke the query.
  const anomaliesKnown = anomaliesQuery.isSuccess;
  const anomalyCount = anomaliesQuery.data?.anomalies.length ?? 0;

  return (
    <VStack align="stretch" gap={5} width="full">
      <ActiveOperationsSection data={data} />

      <StatStrip data={data} />

      <HealthLine
        errorClusterCount={data.topErrors.length}
        anomalyCount={anomalyCount}
        anomaliesKnown={anomaliesKnown}
      />

      <ParkedCard
        parkedTenants={data.parkedTenants}
        parkedTenantsBound={data.parkedTenantsBound}
      />

      <Card.Root overflow="hidden">
        <Card.Body padding={4}>
          <Text
            textStyle="xs"
            fontWeight="medium"
            color="fg.muted"
            marginBottom={2}
          >
            Throughput
          </Text>
          <ThroughputChart data={data} />
        </Card.Body>
      </Card.Root>

      <PipelineTreeCard
        pipelineTree={data.pipelineTree}
        pausedKeys={data.pausedKeys}
        queueNames={queueNames}
      />

      <TopErrorsCard
        topErrors={data.topErrors}
        errorClustersBound={data.errorClustersBound}
      />

      <AnomaliesCard />
      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
      <GroupsCard queueNames={queueNames} />

      <ReplayHistorySection />
    </VStack>
  );
}
