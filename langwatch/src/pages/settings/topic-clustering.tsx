import { Alert, Button, Card, Heading, Text, VStack } from "@chakra-ui/react";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { api } from "~/utils/api";
import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { EmbeddingsModel, TopicClusteringModel } from "./model-providers";

function TopicClusteringSettings() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  if (!project) return null;

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <Heading as="h2">Topic Clustering</Heading>

        <TopicClusteringCard project={project} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("project:manage", {
  layoutComponent: SettingsLayout,
})(TopicClusteringSettings);

function TopicClusteringCard({ project }: { project: { id: string } }) {
  const triggerClustering = api.project.triggerTopicClustering.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Topic clustering started",
        description:
          "The topic clustering job has been queued and will run shortly.",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to trigger topic clustering",
        description: error.message,
        type: "error",
      });
    },
  });

  return (
    <VStack gap={6} width="full" align="start" paddingBottom={12}>
      <VStack gap={0} width="full" align="stretch">
        <TopicClusteringModel />
        <EmbeddingsModel />
      </VStack>

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
