/**
 * The topic-clustering schedule, at `/settings/topic-clustering`. THREE PARTS OVER TWO READS:
 * stat tiles for the last and next run, a card that asks for a run now, and the log of runs.
 */

import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { ListTable } from "@langwatch/design-system/list-table";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  StatTile,
  StatTileFigure,
  StatTileGrid,
  StatTileSkeleton,
} from "@langwatch/design-system/stat-tile";
import type {
  ClusteringErrorCode,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicClusteringRunMode,
  TopicClusteringSkipReason,
} from "@langwatch/topic-contract";

import { topicApi } from "../../behavior/topic-api.ts";
import {
  useClusteringRunHistory,
  useClusteringStatus,
} from "../../behavior/use-topic-clustering.ts";
import { useTopicHost } from "../../model/topic-host.ts";

/**
 * The server sends bare strings for codes/reasons/modes; these lookups narrow them back onto
 * the canonical unions so an unknown value falls through to each call site's fallback instead
 * of silently rendering nothing new.
 */
function copyFor<K extends string, V>(
  map: Partial<Record<K, V>>,
  key: string | null,
): V | undefined {
  return key ? map[key as K] : undefined;
}

// Deliberately Partial: a code with no entry is treated as ours to fix (see
// the doc above), so exhaustiveness would defeat the fallback.
const CLUSTERING_FAILURE_GUIDANCE: Partial<
  Record<ClusteringErrorCode, { title: string; description: string }>
> = {
  model_not_configured: {
    title: "No model is set up for topic clustering",
    description:
      "Choose a default model and embeddings for topic clustering in Settings → Model Providers → Default Models, then run it again.",
  },
  model_provider_auth: {
    title: "Your model provider rejected the credentials",
    description:
      "Check the API key for your topic clustering model in Settings → Model Providers, then run topic clustering again.",
  },
  model_provider_quota: {
    title: "Your model provider refused the request",
    description:
      "This usually means the account is out of quota or credit. Check your limits and billing with the provider, then run topic clustering again.",
  },
};

export default function TopicClusteringScreen() {
  const project = useTopicHost().project();

  if (!project) return null;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Topic Clustering</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          Groups your traces into topics and subtopics on a schedule, so you can see what your users
          talk about.
        </Text>

        <TopicClusteringCard project={project} />
      </VStack>
    </>
  );
}

function TopicClusteringCard({ project }: { project: { id: string } }) {
  const host = useTopicHost();
  const utils = topicApi.useUtils();

  const triggerClustering = topicApi.project.triggerTopicClustering.useMutation({
    onSuccess: (result) => {
      if (result.started) {
        host.succeeded({
          title: "Topic clustering started",
          description: "This can take several minutes.",
        });
      } else {
        // Not a failure: a run was already underway, and its results land here.
        host.succeeded({
          title: "A run is already in progress",
          description: "Its results will appear here when it finishes.",
        });
      }
      void utils.topics.getClusteringStatus.invalidate({
        projectId: project.id,
      });
      void utils.topics.getClusteringRunHistory.invalidate({
        projectId: project.id,
      });
    },
    onError: (error) => {
      // The server's message is a fixed sentence (the failure detail is
      // internal and logged server-side), so don't echo it as the description.
      host.failed({
        error,
        fallbackTitle: "Failed to trigger topic clustering",
        description: "Please try again in a moment.",
      });
    },
  });

  return (
    <VStack gap={6} width="full" align="stretch" paddingBottom={12}>
      <ClusteringStatusCard projectId={project.id} />
      <Card.Root width="full">
        <Card.Header>
          <Heading>Manual topic clustering</Heading>
        </Card.Header>
        <Card.Body width="full">
          <VStack align="start" gap={4}>
            <Text>
              Group your recent traces into topics and subtopics without waiting for the next
              scheduled run. Choose the model and embeddings it uses in{" "}
              <strong>Settings → Model Providers → Default Models</strong>.
            </Text>

            <Alert.Root>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Topic clustering needs at least 10 traces to group anything, and can take several
                  minutes.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>

            <Button
              colorPalette="orange"
              onClick={() => triggerClustering.mutate({ projectId: project.id })}
              loading={triggerClustering.isPending}
            >
              Run topic clustering
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>
      <RunHistoryCard projectId={project.id} />
    </VStack>
  );
}

// Exhaustive over the union on purpose: adding a skip reason without copy for
// it is a compile error here, not a blank line in the UI.
const SKIP_REASON_COPY: Record<TopicClusteringSkipReason, string> = {
  recently_clustered: "Skipped, your topics were rebuilt recently so this run was not needed yet",
  not_enough_traces: "Skipped, not enough new traces to group yet",
  not_configured: "Skipped, no topic clustering model is set up",
};

/** What each run mode did, in the customer's terms rather than the enum's. */
const RUN_MODE_COPY: Record<TopicClusteringRunMode, string> = {
  batch: "Rebuilt all topics",
  incremental: "Sorted new traces into your existing topics",
};

function outcomeBadge(outcome: string | null, isRunInFlight: boolean) {
  if (isRunInFlight) return <Badge colorPalette="blue">Running</Badge>;
  switch (outcome) {
    case "completed":
      return <Badge colorPalette="green">Completed</Badge>;
    case "skipped":
      return <Badge colorPalette="gray">Skipped</Badge>;
    case "failed":
      return <Badge colorPalette="red">Failed</Badge>;
    case "running":
      return <Badge colorPalette="blue">Running</Badge>;
    case "abandoned":
      return <Badge colorPalette="orange">Interrupted</Badge>;
    default:
      return <Badge colorPalette="gray">Never run</Badge>;
  }
}

function ClusteringStatusBody({
  isLoading,
  data,
}: {
  isLoading: boolean;
  data: TopicClusteringStatus | undefined;
}) {
  if (isLoading) return <StatTileSkeleton columns={3} />;
  if (!data) return <Text color="fg.muted">Clustering status is unavailable.</Text>;
  const completed = data.lastRunOutcome === "completed";
  return (
    <VStack align="stretch" gap={3} width="full">
      <StatTileGrid columns={3}>
        <StatTile
          label="Last run"
          hint={data.lastRunAt ? (formatTimeAgo(data.lastRunAt) ?? void 0) : void 0}
        >
          <HStack>{outcomeBadge(data.lastRunOutcome, data.isRunInFlight)}</HStack>
        </StatTile>
        <StatTile label="Next scheduled run">
          <StatTileFigure muted={!data.nextRunAt}>
            {data.nextRunAt ? (formatTimeAgo(data.nextRunAt) ?? "") : "Not scheduled yet"}
          </StatTileFigure>
        </StatTile>
        <StatTile
          label="Topics"
          hint={
            completed
              ? `${data.lastRunSubtopicsCount} subtopics from ${data.lastRunTracesProcessed} traces`
              : void 0
          }
        >
          <StatTileFigure muted={!completed}>
            {completed ? data.lastRunTopicsCount : "None yet"}
          </StatTileFigure>
        </StatTile>
      </StatTileGrid>
      {data.lastRunOutcome === "completed" && (
        <Text fontSize="sm" color="fg.muted">
          {/* The mode is only trustworthy on a completed run: a failure
              leaves the previous run's mode in place. */}
          {(() => {
            const modeCopy = copyFor(RUN_MODE_COPY, data.lastRunMode);
            return modeCopy ? `${modeCopy}. ` : null;
          })()}
          Organized {data.lastRunTracesProcessed} traces into {data.lastRunTopicsCount} topics and{" "}
          {data.lastRunSubtopicsCount} subtopics.
        </Text>
      )}
      {data.lastRunOutcome === "skipped" && data.lastRunSkippedReason && (
        <Text fontSize="sm" color="fg.muted">
          {copyFor(SKIP_REASON_COPY, data.lastRunSkippedReason) ?? "Skipped"}.
        </Text>
      )}
      {data.lastRunOutcome === "failed" &&
        (() => {
          const guidance = data.isLastRunErrorUserActionable
            ? copyFor(CLUSTERING_FAILURE_GUIDANCE, data.lastRunErrorCode)
            : undefined;
          return guidance ? (
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{guidance.title}</Alert.Title>
                <Alert.Description>{guidance.description}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : (
            <Text fontSize="sm" color="red.fg">
              The last run failed on our side. It will retry automatically at the next scheduled
              run.
            </Text>
          );
        })()}
    </VStack>
  );
}

function ClusteringStatusCard({ projectId }: { projectId: string }) {
  const status = useClusteringStatus({ projectId });

  return <ClusteringStatusBody isLoading={status.isLoading} data={status.data} />;
}

/**
 * What one history row says about its run, in the customer's terms. The
 * server never sends raw error text (ADR-051 §8) — a failed run's detail is
 * the same fixed guidance the status card uses.
 */
function runDetail(run: {
  outcome: string;
  mode: string | null;
  skippedReason: string | null;
  errorCode: string | null;
  isErrorUserActionable: boolean;
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
}): string {
  switch (run.outcome) {
    case "completed": {
      const modeCopy = copyFor(RUN_MODE_COPY, run.mode);
      const summary = `Organized ${run.tracesProcessed} traces into ${run.topicsCount} topics and ${run.subtopicsCount} subtopics.`;
      return modeCopy ? `${modeCopy}. ${summary}` : summary;
    }
    case "skipped":
      return `${copyFor(SKIP_REASON_COPY, run.skippedReason) ?? "Skipped"}.`;
    case "failed": {
      const guidance = run.isErrorUserActionable
        ? copyFor(CLUSTERING_FAILURE_GUIDANCE, run.errorCode)
        : undefined;
      return guidance
        ? guidance.title
        : "Failed on our side. It retries automatically at the next scheduled run.";
    }
    case "running":
      return "Working through your recent traces…";
    case "abandoned":
      return "The run was interrupted; the next scheduled run starts fresh.";
    default:
      return "";
  }
}

function RunHistoryBody({
  isLoading,
  runs,
}: {
  isLoading: boolean;
  runs: TopicClusteringRunHistoryEntry[];
}) {
  if (runs.length === 0 && !isLoading) {
    return (
      <Text color="fg.muted" textAlign="center" width="full" paddingY={8}>
        No runs yet. History appears here after the first scheduled or manual run.
      </Text>
    );
  }
  return (
    <ListTable size="sm" width="full" containerProps={{ overflowX: "auto" }}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>When</Table.ColumnHeader>
          <Table.ColumnHeader>Started by</Table.ColumnHeader>
          <Table.ColumnHeader>Outcome</Table.ColumnHeader>
          <Table.ColumnHeader>Details</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {isLoading && <LoadingRunRows />}
        {runs.map((run) => (
          <Table.Row key={run.runId}>
            <Table.Cell whiteSpace="nowrap">{formatTimeAgo(run.startedAt) ?? ""}</Table.Cell>
            <Table.Cell whiteSpace="nowrap">
              {run.trigger === "manual" ? "You" : "Schedule"}
            </Table.Cell>
            <Table.Cell>{outcomeBadge(run.outcome, false)}</Table.Cell>
            <Table.Cell>
              <Text fontSize="sm" color="fg.muted">
                {runDetail(run)}
              </Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** Two rows in the history's own shape while it loads. */
function LoadingRunRows() {
  return Array.from({ length: 2 }, (_, index) => (
    <Table.Row key={index}>
      <Table.Cell>
        <Skeleton height="14px" width="72px" />
      </Table.Cell>
      <Table.Cell>
        <Skeleton height="14px" width="64px" />
      </Table.Cell>
      <Table.Cell>
        <Skeleton height="20px" width="80px" />
      </Table.Cell>
      <Table.Cell>
        <Skeleton height="14px" width="70%" />
      </Table.Cell>
    </Table.Row>
  ));
}

function RunHistoryCard({ projectId }: { projectId: string }) {
  const history = useClusteringRunHistory({ projectId });

  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading size="md">Run history</Heading>
      <RunHistoryBody isLoading={history.isLoading} runs={history.data ?? []} />
    </VStack>
  );
}
