import { Card, Text, VStack } from "@chakra-ui/react";
import type { DashboardData } from "@langwatch/ops-contract";
import { HealthLine } from "../elements/dashboard-health-line";
import { LatencyWindowsCard } from "../elements/latency-windows-card";
import { ThroughputChart } from "../elements/throughput-chart";
import { TopErrorsCard } from "../elements/top-errors-card";
import { useMemo } from "react";
import { AnomaliesCard, BlockedCard, DlqCard, GroupsCard, PipelineTreeCard } from "../../../queue";
import { api } from "../../../../behavior/ops-api";
import { ActiveOperationsSection } from "./active-operations-panel";
import { PausedCard } from "./paused-panel";
import { StatStrip } from "./stat-strip";

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
  const queueNames = useMemo(() => (queuesQuery.data ?? []).map((q) => q.name), [queuesQuery.data]);

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

      <PausedCard
        parkedTenants={data.parkedTenants}
        parkedTenantsBound={data.parkedTenantsBound}
        pausedKeys={data.pausedKeys}
      />

      <Card.Root overflow="hidden">
        <Card.Body padding={4}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted" marginBottom={2}>
            Throughput
          </Text>
          <ThroughputChart data={data} />
        </Card.Body>
      </Card.Root>

      <LatencyWindowsCard windows={data.latencyWindows} />

      <PipelineTreeCard
        pipelineTree={data.pipelineTree}
        pausedKeys={data.pausedKeys}
        queueNames={queueNames}
      />

      <TopErrorsCard topErrors={data.topErrors} errorClustersBound={data.errorClustersBound} />

      <AnomaliesCard />
      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
      <GroupsCard queueNames={queueNames} />
    </VStack>
  );
}
