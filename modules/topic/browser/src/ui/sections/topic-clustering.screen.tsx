/**
 * The topic-clustering schedule, at `/settings/topic-clustering`. THREE PARTS OVER TWO READS:
 * stat tiles for the last and next run, a card that asks for a run now, and the log of runs.
 */

import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { LoadMore } from "@langwatch/design-system/load-more";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Alert,
  Badge,
  Button,
  Heading,
  HStack,
  Link,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  StatTile,
  StatTileFigure,
  StatTileGrid,
  StatTileSkeleton,
} from "@langwatch/design-system/stat-tile";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import type {
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
} from "@langwatch/topic-contract";

import { topicApi } from "../../behavior/topic-api.ts";
import { useClusteringStatus } from "../../behavior/use-topic-clustering.ts";
import { useTopicHost } from "../../model/topic-host.ts";
import {
  copyFor,
  failureGuidance,
  MODEL_PROVIDERS_HREF,
  MODEL_PROVIDERS_LINK_LABEL,
  organizedSummary,
  RUN_MODE_COPY,
  runDetail,
  SKIP_REASON_COPY,
  showsModelProvidersLink,
} from "./topic-clustering-copy.ts";

const HISTORY_PAGE_SIZE = 20;
const DOCS_URL = "https://docs.langwatch.ai/features/topic-clustering";

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
  const accent = useProductAccent();

  const triggerClustering = topicApi.topics.triggerTopicClustering.useMutation({
    onSuccess: (result) => {
      if (result.started) {
        host.succeeded({
          title: "Topic clustering started",
          description: "This can take several minutes.",
        });
      } else {
        // Not a failure: a run was already underway, and its results land here.
        host.informed({
          title: "A run is already in progress",
          description: "Its results will appear here when it finishes.",
        });
      }
      void utils.topics.getClusteringStatus.invalidate({
        projectId: project.id,
      });
      void utils.topics.getClusteringRunHistoryPage.invalidate({
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
      <Card title="Manual topic clustering" padding="lg">
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
            colorPalette={accent.colorPalette}
            onClick={() => triggerClustering.mutate({ projectId: project.id })}
            loading={triggerClustering.isPending}
          >
            Run topic clustering
          </Button>
        </VStack>
      </Card>
      <RunHistoryCard projectId={project.id} />
    </VStack>
  );
}

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

function ModelProvidersLink() {
  return (
    <Link href={MODEL_PROVIDERS_HREF} color="fg.muted" fontSize="sm" fontWeight="medium">
      {MODEL_PROVIDERS_LINK_LABEL}
    </Link>
  );
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
          {organizedSummary({
            tracesProcessed: data.lastRunTracesProcessed,
            topicsCount: data.lastRunTopicsCount,
            subtopicsCount: data.lastRunSubtopicsCount,
          })}
        </Text>
      )}
      {data.lastRunOutcome === "skipped" && data.lastRunSkippedReason && (
        <Text fontSize="sm" color="fg.muted">
          {copyFor(SKIP_REASON_COPY, data.lastRunSkippedReason) ?? "Skipped"}.
        </Text>
      )}
      {data.lastRunOutcome === "failed" &&
        (() => {
          const guidance = failureGuidance({
            errorCode: data.lastRunErrorCode,
            isErrorUserActionable: data.isLastRunErrorUserActionable,
          });
          return guidance ? (
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{guidance.title}</Alert.Title>
                <Alert.Description>{guidance.description}</Alert.Description>
                <ModelProvidersLink />
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

function RunHistoryCard({ projectId }: { projectId: string }) {
  const history = topicApi.topics.getClusteringRunHistoryPage.useInfiniteQuery(
    { projectId, limit: HISTORY_PAGE_SIZE },
    {
      getNextPageParam: (lastPage) =>
        lastPage.outcome === "page" && lastPage.hasMore ? (lastPage.nextCursor ?? void 0) : void 0,
    },
  );
  const pages = history.data?.pages ?? [];
  const runs: TopicClusteringRunHistoryEntry[] = pages.flatMap((page) =>
    page.outcome === "page" ? page.entries : [],
  );
  const expired = pages.some((page) => page.outcome === "cursor_expired");

  const showBody = () => {
    if (history.isError && runs.length === 0) {
      return (
        <HStack gap={2}>
          <Text color="fg.error">Could not load the run history.</Text>
          <Button size="xs" variant="outline" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </HStack>
      );
    }
    if (runs.length === 0 && !history.isLoading) {
      return (
        <NoDataInfoBlock
          size="line"
          title="No runs yet. History appears here after the first scheduled or manual run."
          next={[{ kind: "docs", label: "About topic clustering", href: DOCS_URL }]}
        />
      );
    }
    return (
      <>
        <ListTable
          density="compact"
          scroll="x"
          scrollLabel="Run history table"
          loading={history.isFetchingNextPage}
        >
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>When</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Started by</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Outcome</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Details</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {history.isLoading && <ListTable.LoadingRows rows={2} columns={4} />}
            {runs.map((run) => (
              <ListTable.Row key={run.runId}>
                <ListTable.Cell nowrap>{formatTimeAgo(run.startedAt) ?? ""}</ListTable.Cell>
                <ListTable.Cell nowrap>
                  {run.trigger === "manual" ? "You" : "Schedule"}
                </ListTable.Cell>
                <ListTable.Cell>{outcomeBadge(run.outcome, false)}</ListTable.Cell>
                <ListTable.Cell>
                  <VStack align="start" gap={1}>
                    <Text fontSize="sm" color="fg.muted">
                      {runDetail(run)}
                    </Text>
                    {showsModelProvidersLink(run) && <ModelProvidersLink />}
                  </VStack>
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
        {expired && (
          <HStack justify="center" gap={2}>
            <Text as="output" textStyle="xs" color="fg.muted">
              The history moved on while you were reading.
            </Text>
            <Button size="xs" variant="outline" onClick={() => void history.refetch()}>
              Show newest runs
            </Button>
          </HStack>
        )}
        <LoadMore
          hasMore={!expired && (history.hasNextPage ?? false)}
          loading={history.isFetchingNextPage}
          onLoadMore={() => void history.fetchNextPage()}
        />
      </>
    );
  };

  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading size="sm">Run history</Heading>
      {showBody()}
    </VStack>
  );
}
