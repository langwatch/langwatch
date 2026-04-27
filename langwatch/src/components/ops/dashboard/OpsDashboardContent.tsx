import { useMemo } from "react";
import {
  Box,
  Card,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { DashboardData } from "~/server/app-layer/ops/types";
import {
  formatCount,
  formatMs,
  formatRate,
} from "~/components/ops/shared/formatters";
import { api } from "~/utils/api";
import { ActiveOperationsSection } from "./ActiveOperationsSection";
import { LinkedStat } from "./LinkedStat";
import { ReplayHistorySection } from "./ReplayHistorySection";
import { ThroughputChart } from "./ThroughputChart";
import { PipelineTreeCard } from "~/components/ops/queues/PipelineTreeCard";
import { BlockedCard } from "~/components/ops/queues/BlockedCard";
import { DlqCard } from "~/components/ops/queues/DlqCard";
import { GroupsCard } from "~/components/ops/queues/GroupsCard";

export function OpsDashboardContent({ data }: { data: DashboardData }) {
  const totalBlocked = data.queues.reduce(
    (sum, q) => sum + q.blockedGroupCount,
    0,
  );
  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqCount, 0);

  const queuesQuery = api.ops.listQueues.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const queueNames = useMemo(
    () => (queuesQuery.data ?? []).map((q) => q.name),
    [queuesQuery.data],
  );

  return (
    <VStack align="stretch" gap={5} width="full">
      <ActiveOperationsSection data={data} />

      <SimpleGrid columns={{ base: 2, md: 4, lg: 7 }} gap={1}>
        <LinkedStat
          label="Staged/s"
          value={formatRate(data.throughputIngestedPerSec)}
          sublabel={`peak ${formatRate(data.peakIngestedPerSec)}`}
        />
        <LinkedStat
          label="Completed/s"
          value={formatRate(data.completedPerSec)}
          sublabel={`${formatCount(data.totalCompleted)} total`}
        />
        <LinkedStat
          label="Failed/s"
          value={formatRate(data.failedPerSec)}
          sublabel={data.totalFailed > 0 ? `${formatCount(data.totalFailed)} total` : undefined}
          color={data.failedPerSec > 0 ? "red.500" : undefined}
        />
        <LinkedStat
          label="Blocked"
          value={totalBlocked.toString()}
          sublabel={`${data.totalGroups} groups`}
          color={totalBlocked > 0 ? "red.500" : undefined}
        />
        <LinkedStat
          label="P50"
          value={formatMs(data.latencyP50Ms)}
          sublabel={`peak ${formatMs(data.peakLatencyP50Ms)}`}
        />
        <LinkedStat
          label="P99"
          value={formatMs(data.latencyP99Ms)}
          sublabel={`peak ${formatMs(data.peakLatencyP99Ms)}`}
        />
        <LinkedStat
          label="DLQ"
          value={totalDlq.toString()}
          sublabel={data.redisMemoryUsed}
          color={totalDlq > 0 ? "orange.500" : undefined}
        />
      </SimpleGrid>

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

      <Card.Root overflow="hidden">
        <HStack paddingX={4} paddingTop={3} paddingBottom={2}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Top Errors
          </Text>
        </HStack>
        {data.topErrors.length > 0 ? (
          <Table.ScrollArea>
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="60px">Count</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.topErrors.slice(0, 5).map((err, i) => (
                  <Table.Row key={i}>
                    <Table.Cell>
                      <Text color="red.500" fontWeight="medium">
                        {err.count}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text truncate maxWidth="400px">
                        {err.sampleMessage}
                      </Text>
                    </Table.Cell>
                    <Table.Cell color="fg.muted">
                      {err.pipelineName ?? "\u2014"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        ) : (
          <Box paddingX={4} paddingBottom={4}>
            <Text textStyle="xs" color="fg.muted">
              {totalBlocked > 0 ? "0 errors" : "No errors"}
            </Text>
          </Box>
        )}
      </Card.Root>

      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
      <GroupsCard queueNames={queueNames} />

      <ReplayHistorySection />
    </VStack>
  );
}
