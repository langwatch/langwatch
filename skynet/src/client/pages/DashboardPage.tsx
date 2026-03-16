import { useState, useCallback, useMemo } from "react";
import { Box, Text, Grid, GridItem } from "@chakra-ui/react";
import type { DashboardData, QueueInfo } from "../../shared/types.ts";
import type { SortColumn, SortDir } from "../hooks/useGroupsData.ts";
import type { UnblockSessionConfig } from "../components/UnblockSession.tsx";
import { apiPost } from "../hooks/useApi.ts";
import { StatCards } from "../components/dashboard/StatCards.tsx";
import { ThroughputChart } from "../components/dashboard/ThroughputChart.tsx";
import { PipelineTree } from "../components/dashboard/PipelineTree.tsx";
import { RedisStats } from "../components/dashboard/RedisStats.tsx";
import { GroupsTable } from "../components/groups/GroupsTable.tsx";
import { TopErrorsPanel } from "../components/dashboard/TopErrorsPanel.tsx";
import { AgeHistogram } from "../components/dashboard/AgeHistogram.tsx";
import { ActiveJobsPanel } from "../components/dashboard/ActiveJobsPanel.tsx";
import { SuggestionsPanel } from "../components/dashboard/SuggestionsPanel.tsx";

interface Props {
  data: DashboardData;
  queues: QueueInfo[];
  onPause: () => void;
  onResume: () => void;
  sortColumn: SortColumn;
  sortDir: SortDir;
  cycleSort: (col: SortColumn) => void;
  onStartUnblockSession: (config: UnblockSessionConfig) => void;
}

export function DashboardPage({ data, queues, onPause, onResume, sortColumn, sortDir, cycleSort, onStartUnblockSession }: Props) {
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);

  const queueNames = useMemo(() => data.queues.map((q) => q.name), [data.queues]);

  const handlePause = useCallback(
    async (pauseKey: string) => {
      const results = await Promise.allSettled(
        queueNames.map((queueName) =>
          apiPost("/api/actions/pause", { queueName, pauseKey }),
        ),
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error("Pause failed for some queues:", failures);
      }
    },
    [queueNames],
  );

  const handleUnpause = useCallback(
    async (pauseKey: string) => {
      const results = await Promise.allSettled(
        queueNames.map((queueName) =>
          apiPost("/api/actions/unpause", { queueName, pauseKey }),
        ),
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error("Unpause failed for some queues:", failures);
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
      <StatCards data={data} />
      <SuggestionsPanel data={data} />
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
      {data.topErrors.length > 0 && (
        <Box mb={6}>
          <TopErrorsPanel
            errors={data.topErrors}
            queueName={data.queues[0]?.name ?? null}
            onPause={onPause}
            onResume={onResume}
          />
        </Box>
      )}
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
        onStartUnblockSession={onStartUnblockSession}
      />
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={4} mb={6} mt={6}>
        <GridItem>
          <AgeHistogram queues={queues} />
        </GridItem>
        <GridItem>
          <ActiveJobsPanel queues={queues} />
        </GridItem>
      </Grid>
    </Box>
  );
}
