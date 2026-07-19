import {
  Alert,
  Badge,
  Button,
  Card,
  HStack,
  Heading,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import type { ClusteringErrorCode } from "~/server/app-layer/topic-clustering/clustering-error";
import type {
  TopicClusteringRunMode,
  TopicClusteringSkipReason,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/constants";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Fixed copy per failure code. The classifier's code is the ONLY thing the
 * server sends about a failure — never the provider's response body, which is
 * a langevals/provider payload (tracebacks, internal hostnames, echoed key
 * prefixes) and not something to put in front of a customer.
 *
 * A code with no entry here is treated as ours to fix, which is also what an
 * unrecognised or mis-scoped classification degrades to.
 */
/**
 * The server sends bare strings for codes/reasons/modes; these lookups narrow
 * them back onto the canonical unions so an unknown value falls through to
 * each call site's fallback instead of silently rendering nothing new.
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
  const utils = api.useContext();
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
              loading={triggerClustering.isLoading}
            >
              Run topic clustering
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

// Exhaustive over the union on purpose: adding a skip reason without copy for
// it is a compile error here, not a blank line in the UI.
const SKIP_REASON_COPY: Record<TopicClusteringSkipReason, string> = {
  recently_clustered:
    "Skipped, your topics were rebuilt recently so this run was not needed yet",
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
    default:
      return <Badge colorPalette="gray">Never run</Badge>;
  }
}

function ClusteringStatusCard({
  projectId,
  lastTriggeredAt,
}: {
  projectId: string;
  lastTriggeredAt: number | null;
}) {
  const status = api.topics.getClusteringStatus.useQuery(
    { projectId },
    {
      refetchInterval: (data) => {
        if (data?.isRunInFlight) return RUNNING_POLL_MS;
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
                  const modeCopy = copyFor(RUN_MODE_COPY, status.data.lastRunMode);
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
                  {copyFor(SKIP_REASON_COPY, status.data.lastRunSkippedReason) ??
                    "Skipped"}
                  .
                </Text>
              )}
            {status.data.lastRunOutcome === "failed" &&
              (() => {
                const guidance = status.data.isLastRunErrorUserActionable
                  ? copyFor(
                      CLUSTERING_FAILURE_GUIDANCE,
                      status.data.lastRunErrorCode,
                    )
                  : undefined;
                return guidance ? (
                  <Alert.Root status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{guidance.title}</Alert.Title>
                      <Alert.Description>
                        {guidance.description}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                ) : (
                  <Text fontSize="sm" color="red.fg">
                    The last run failed on our side. It will retry
                    automatically at the next scheduled run.
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
