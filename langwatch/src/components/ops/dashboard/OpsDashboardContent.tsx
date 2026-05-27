import {
  Box,
  Card,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { AnomaliesCard } from "~/components/ops/queues/AnomaliesCard";
import { BlockedCard } from "~/components/ops/queues/BlockedCard";
import { DlqCard } from "~/components/ops/queues/DlqCard";
import { GroupsCard } from "~/components/ops/queues/GroupsCard";
import { PipelineTreeCard } from "~/components/ops/queues/PipelineTreeCard";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { ActiveOperationsSection } from "./ActiveOperationsSection";
import { RedisStatTiles } from "./RedisStatTiles";
import { ReplayHistorySection } from "./ReplayHistorySection";
import { ThroughputChart } from "./ThroughputChart";
import { ThroughputStatTiles } from "./ThroughputStatTiles";

export function OpsDashboardContent({ data }: { data: DashboardData }) {
  const totalBlocked = data.queues.reduce(
    (sum, q) => sum + q.blockedGroupCount,
    0,
  );

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

      <SimpleGrid columns={{ base: 2, md: 5, lg: 10 }} gap={1}>
        <ThroughputStatTiles data={data} />
        <RedisStatTiles data={data} />
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
            <Table.Root
              size="sm"
              variant="line"
              css={{ "& tr:last-child td": { borderBottom: "none" } }}
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="60px">Count</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.topErrors.slice(0, 5).map((err) => (
                  <Table.Row key={`${err.queueName}::${err.normalizedMessage}`}>
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

      <AnomaliesCard />
      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
      <GroupsCard queueNames={queueNames} />

      <ReplayHistorySection />
    </VStack>
  );
}
