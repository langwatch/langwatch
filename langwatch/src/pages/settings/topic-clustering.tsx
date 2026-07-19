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
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { api } from "~/utils/api";
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
const CLUSTERING_FAILURE_GUIDANCE: Record<
  string,
  { title: string; description: string }
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
        <Heading as="h2">Topic Clustering</Heading>
        <Text fontSize="sm" color="fg.muted">
          The model and embeddings used for topic clustering are
          configured in <strong>Settings → Model Providers → Default
          Models</strong> (the `analytics.topic_clustering_llm` and
          `analytics.topic_clustering_embeddings` feature keys).
        </Text>

        <TopicClusteringCard project={project} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("project:manage", {
  layoutComponent: SettingsLayout,
})(TopicClusteringSettings);

function TopicClusteringCard({ project }: { project: { id: string } }) {
  const utils = api.useContext();
  const triggerClustering = api.project.triggerTopicClustering.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Topic clustering started",
        description:
          "The topic clustering run has been requested and will start shortly.",
        type: "success",
      });
      void utils.topics.getClusteringStatus.invalidate({
        projectId: project.id,
      });
    },
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Failed to trigger topic clustering",
        description: error.message,
        type: "error",
      });
    },
  });

  return (
    <VStack gap={6} width="full" align="start" paddingBottom={12}>
      <ClusteringStatusCard projectId={project.id} />
      <Card.Root width="full">
        <Card.Header>
          <Heading>Manual Topic Clustering</Heading>
        </Card.Header>
        <Card.Body width="full">
          <VStack align="start" gap={4}>
            <Text>
              Manually trigger topic clustering to organize your traces into
              topics and subtopics. This will analyze your recent traces and
              group them by similar patterns.
            </Text>

            <Alert.Root>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Topic clustering requires at least 10 traces to run
                  effectively. The process may take several minutes depending on
                  the number of traces.
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
              Run Topic Clustering
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

const SKIP_REASON_COPY: Record<string, string> = {
  recently_clustered:
    "Skipped — topics were rebuilt recently, so this run wasn't needed yet",
  not_enough_traces: "Skipped — not enough new traces to cluster yet",
  not_configured: "Skipped — no topic clustering model is configured",
};

function outcomeBadge(outcome: string | null, inProgress: boolean) {
  if (inProgress) return <Badge colorPalette="blue">Running</Badge>;
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

function ClusteringStatusCard({ projectId }: { projectId: string }) {
  const status = api.topics.getClusteringStatus.useQuery(
    { projectId },
    { refetchInterval: 30_000 },
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
              {outcomeBadge(status.data.lastRunOutcome, status.data.inProgress)}
              {status.data.lastRunAt && (
                <Text color="fg.muted">
                  {new Date(status.data.lastRunAt).toLocaleString()}
                </Text>
              )}
            </HStack>
            {status.data.lastRunOutcome === "completed" && (
              <Text fontSize="sm" color="fg.muted">
                Organized {status.data.lastRunTracesProcessed} traces into{" "}
                {status.data.lastRunTopicsCount} topics and{" "}
                {status.data.lastRunSubtopicsCount} subtopics.
              </Text>
            )}
            {status.data.lastRunOutcome === "skipped" &&
              status.data.lastRunSkippedReason && (
                <Text fontSize="sm" color="fg.muted">
                  {SKIP_REASON_COPY[status.data.lastRunSkippedReason] ??
                    "Skipped"}
                  .
                </Text>
              )}
            {status.data.lastRunOutcome === "failed" &&
              (() => {
                const guidance = status.data.lastRunErrorUserActionable
                  ? CLUSTERING_FAILURE_GUIDANCE[
                      status.data.lastRunErrorCode ?? ""
                    ]
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
                  ? new Date(status.data.nextRunAt).toLocaleString()
                  : "Scheduled after your project receives its first traces"}
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
