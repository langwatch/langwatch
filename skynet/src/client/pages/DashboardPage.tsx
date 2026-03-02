import { useState, useCallback } from "react";
import { Box, Text, Grid, GridItem } from "@chakra-ui/react";
import type { DashboardData, QueueInfo } from "../../shared/types.ts";
import type { SortColumn, SortDir } from "../hooks/useGroupsData.ts";
import { apiPost } from "../hooks/useApi.ts";
import { StatCards } from "../components/dashboard/StatCards.tsx";
import { ThroughputChart } from "../components/dashboard/ThroughputChart.tsx";
import { PipelineTree } from "../components/dashboard/PipelineTree.tsx";
import { RedisStats } from "../components/dashboard/RedisStats.tsx";
import { GroupsTable } from "../components/groups/GroupsTable.tsx";
import { QueueOverview } from "../components/dashboard/QueueOverview.tsx";

interface Props {
  data: DashboardData;
  queues: QueueInfo[];
  onPause: () => void;
  onResume: () => void;
  sortColumn: SortColumn;
  sortDir: SortDir;
  cycleSort: (col: SortColumn) => void;
}

export function DashboardPage({ data, queues, onPause, onResume, sortColumn, sortDir, cycleSort }: Props) {
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);

  const queueNames = data.queues.map((q) => q.name);

  const handlePause = useCallback(
    async (pauseKey: string) => {
      for (const queueName of queueNames) {
        await apiPost("/api/actions/pause", { queueName, pauseKey });
      }
    },
    [queueNames],
  );

  const handleUnpause = useCallback(
    async (pauseKey: string) => {
      for (const queueName of queueNames) {
        await apiPost("/api/actions/unpause", { queueName, pauseKey });
      }
    },
    [queueNames],
  );

  return (
    <Box p={6}>
      <Text
        fontSize="xl"
        fontWeight="bold"
        mb={4}
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.2em"
        textShadow="0 0 15px rgba(0, 240, 255, 0.3)"
      >
        SYSTEM OVERVIEW
      </Text>
      <RedisStats data={data} />
      <StatCards data={data} queues={queues} />
      <Grid templateColumns={{ base: "1fr", lg: "3fr 2fr" }} gap={4} mb={6}>
        <GridItem>
          <ThroughputChart data={data.throughputHistory} />
        </GridItem>
        <GridItem>
          <PipelineTree
            nodes={data.pipelineTree}
            selectedPipeline={pipelineFilter}
            onSelectPipeline={setPipelineFilter}
            pausedKeys={data.pausedKeys}
            onPause={handlePause}
            onUnpause={handleUnpause}
          />
        </GridItem>
      </Grid>
      <Text
        fontSize="sm"
        fontWeight="600"
        color="#00f0ff"
        mb={3}
        textTransform="uppercase"
        letterSpacing="0.15em"
      >
        // Groups
      </Text>
      <GroupsTable
        queues={queues}
        onPause={onPause}
        onResume={onResume}
        sortColumn={sortColumn}
        sortDir={sortDir}
        cycleSort={cycleSort}
        pipelineFilter={pipelineFilter}
      />
      <QueueOverview />
    </Box>
  );
}
