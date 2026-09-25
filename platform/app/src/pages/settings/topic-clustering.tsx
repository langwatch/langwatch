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
} from "@chakra-ui/react";
import { useState } from "react";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  copyFor,
  failureGuidance,
  MODEL_PROVIDERS_HREF,
  MODEL_PROVIDERS_LINK_LABEL,
  RUN_MODE_COPY,
  runDetail,
  SKIP_REASON_COPY,
  showsModelProvidersLink,
} from "./topic-clustering-copy";

function TopicClusteringSettings() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  if (!project) return null;

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        {/* Names the feature, matching the settings nav entry. */}
        <Heading as="h2">Topic Clustering</Heading>
        <Text fontSize="sm" color="fg.muted">
          Choose the model and embeddings used for topic clustering in{" "}
          <strong>Settings → Model Providers → Default Models</strong>.
        </Text>

        <TopicClusteringCard project={project} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("project:manage", {
  layoutComponent: SettingsLayout,
})(TopicClusteringSettings);

/**
 * How long a just-requested run keeps the status card polling. Nothing is
 * recorded at the instant a run begins, so the card cannot see the run until
 * the request itself reaches the read model; without this window the card
 * would settle on the pre-click answer and sit there.
 */
const REQUEST_SETTLE_WINDOW_MS = 30_000;

/** Poll cadence while a run is underway; the query stops itself once it settles. */
const RUNNING_POLL_MS = 5_000;

function TopicClusteringCard({ project }: { project: { id: string } }) {
  const utils = api.useUtils();
  const [lastTriggeredAt, setLastTriggeredAt] = useState<number | null>(null);

  const triggerClustering = api.project.triggerTopicClustering.useMutation({
    onSuccess: (result) => {
      if (result.started) {
        setLastTriggeredAt(Date.now());
        toaster.create({
          title: "Topic clustering started",
          description: "This can take several minutes.",
          type: "success",
        });
      } else {
        toaster.create({
          title: "A run is already in progress",
          description: "Its results will appear here when it finishes.",
          type: "info",
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
      if (isHandledByGlobalHandler(error)) return;
      // The server's message is a fixed sentence (the failure detail is
      // internal and logged server-side), so don't echo it as the description.
      toaster.create({
        title: "Failed to trigger topic clustering",
        description: "Please try again in a moment.",
        type: "error",
      });
    },
  });

  return (
    <VStack gap={6} width="full" align="start" paddingBottom={12}>
      <ClusteringStatusCard
        projectId={project.id}
        lastTriggeredAt={lastTriggeredAt}
      />
      <Card.Root width="full">
        <Card.Header>
          <Heading>Manual topic clustering</Heading>
        </Card.Header>
        <Card.Body width="full">
          <VStack align="start" gap={4}>
            <Text>
              Group your recent traces into topics and subtopics without waiting
              for the next scheduled run.
            </Text>

            <Alert.Root>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Topic clustering needs at least 10 traces to group anything,
                  and can take several minutes.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>

            <Button
              colorPalette="blue"
              onClick={() =>
                triggerClustering.mutate({ projectId: project.id })
              }
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

export function ClusteringStatusCard({
  projectId,
  lastTriggeredAt,
}: {
  projectId: string;
  lastTriggeredAt: number | null;
}) {
  const status = api.topics.getClusteringStatus.useQuery(
    { projectId },
    {
      refetchInterval: (query) => {
        if (query.state.data?.isRunInFlight) return RUNNING_POLL_MS;
        if (
          lastTriggeredAt !== null &&
          Date.now() - lastTriggeredAt < REQUEST_SETTLE_WINDOW_MS
        ) {
          return RUNNING_POLL_MS;
        }
        return false;
      },
    },
  );

  return (
    <Card.Root width="full">
      <Card.Header>
        <Heading>Schedule</Heading>
      </Card.Header>
      <Card.Body width="full">
        {status.isLoading ? (
          <VStack align="start" gap={2} width="full">
            <Skeleton height="20px" width="60%" />
            <Skeleton height="20px" width="40%" />
          </VStack>
        ) : status.data ? (
          <VStack align="start" gap={3}>
            <HStack gap={3}>
              <Text fontWeight="medium">Last run</Text>
              {outcomeBadge(
                status.data.lastRunOutcome,
                status.data.isRunInFlight,
              )}
              {status.data.lastRunAt && (
                <Text color="fg.muted">
                  {formatTimeAgo(status.data.lastRunAt)}
                </Text>
              )}
            </HStack>
            {status.data.lastRunOutcome === "completed" && (
              <Text fontSize="sm" color="fg.muted">
                {/* The mode is only trustworthy on a completed run: a failure
                    leaves the previous run's mode in place. */}
                {(() => {
                  const modeCopy = copyFor(
                    RUN_MODE_COPY,
                    status.data.lastRunMode,
                  );
                  return modeCopy ? `${modeCopy}. ` : null;
                })()}
                Organized {status.data.lastRunTracesProcessed} traces into{" "}
                {status.data.lastRunTopicsCount} topics and{" "}
                {status.data.lastRunSubtopicsCount} subtopics.
              </Text>
            )}
            {status.data.lastRunOutcome === "skipped" &&
              status.data.lastRunSkippedReason && (
                <Text fontSize="sm" color="fg.muted">
                  {copyFor(
                    SKIP_REASON_COPY,
                    status.data.lastRunSkippedReason,
                  ) ?? "Skipped"}
                  .
                </Text>
              )}
            {status.data.lastRunOutcome === "failed" &&
              (() => {
                const guidance = failureGuidance({
                  errorCode: status.data.lastRunErrorCode,
                  isErrorUserActionable:
                    status.data.isLastRunErrorUserActionable,
                });
                return guidance ? (
                  <Alert.Root status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{guidance.title}</Alert.Title>
                      <Alert.Description>
                        {guidance.description}
                      </Alert.Description>
                      <Link
                        href={MODEL_PROVIDERS_HREF}
                        color="fg.muted"
                        fontSize="sm"
                        fontWeight="medium"
                      >
                        {MODEL_PROVIDERS_LINK_LABEL}
                      </Link>
                    </Alert.Content>
                  </Alert.Root>
                ) : (
                  <Text fontSize="sm" color="red.fg">
                    The last run failed on our side. It will retry automatically
                    at the next scheduled run.
                  </Text>
                );
              })()}
            <HStack gap={3}>
              <Text fontWeight="medium">Next scheduled run</Text>
              <Text color="fg.muted">
                {status.data.nextRunAt
                  ? formatTimeAgo(status.data.nextRunAt)
                  : "Not scheduled yet"}
              </Text>
            </HStack>
          </VStack>
        ) : (
          <Text color="fg.muted">Clustering status is unavailable.</Text>
        )}
      </Card.Body>
    </Card.Root>
  );
}

export function RunHistoryCard({ projectId }: { projectId: string }) {
  const history = api.topics.getClusteringRunHistory.useQuery(
    { projectId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((run) => run.outcome === "running")
          ? RUNNING_POLL_MS
          : false,
    },
  );

  return (
    <Card.Root width="full" overflow="hidden">
      <Card.Header>
        <Heading>Run history</Heading>
      </Card.Header>
      <Card.Body width="full" paddingX={0} paddingY={0} overflowX="auto">
        {history.isLoading ? (
          <VStack align="start" gap={2} width="full" padding={6}>
            <Skeleton height="20px" width="80%" />
            <Skeleton height="20px" width="70%" />
          </VStack>
        ) : history.data && history.data.length > 0 ? (
          <Table.Root variant="line" size="sm" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader>Started by</Table.ColumnHeader>
                <Table.ColumnHeader>Outcome</Table.ColumnHeader>
                <Table.ColumnHeader>Details</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {history.data.map((run) => (
                <Table.Row key={run.runId}>
                  <Table.Cell whiteSpace="nowrap">
                    {formatTimeAgo(run.startedAt)}
                  </Table.Cell>
                  <Table.Cell whiteSpace="nowrap">
                    {run.trigger === "manual" ? "You" : "Schedule"}
                  </Table.Cell>
                  <Table.Cell>{outcomeBadge(run.outcome, false)}</Table.Cell>
                  <Table.Cell>
                    <VStack align="start" gap={1}>
                      <Text fontSize="sm" color="fg.muted">
                        {runDetail(run)}
                      </Text>
                      {showsModelProvidersLink(run) && (
                        <Link
                          href={MODEL_PROVIDERS_HREF}
                          color="fg.muted"
                          fontSize="sm"
                          fontWeight="medium"
                        >
                          {MODEL_PROVIDERS_LINK_LABEL}
                        </Link>
                      )}
                    </VStack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Text color="fg.muted" padding={6}>
            No runs yet. History appears here after the first scheduled or
            manual run.
          </Text>
        )}
      </Card.Body>
    </Card.Root>
  );
}
