import {
  Alert,
  Button,
  Card,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Spacer } from "@chakra-ui/react";
import { api } from "~/utils/api";
import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TopicClusteringModel } from "./model-providers";
import { EmbeddingsModel } from "./model-providers";

export default function TopicClusteringSettings() {
  const { project, hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  if (!project) return null;

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full" marginTop={6}>
          <Heading size="lg" as="h1">
            Topic Clustering
          </Heading>
          <Spacer />
        </HStack>

        <TopicClusteringCard project={project} />
      </VStack>
    </SettingsLayout>
  );
}

function TopicClusteringCard({ project }: { project: { id: string } }) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
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

  // Only show to users with setup permissions
  if (!hasPermission("project:manage")) {
    return (
      <Card.Root>
        <Card.Body>
          <Text color="gray.600">
            You need project setup permissions to manage topic clustering.
          </Text>
        </Card.Body>
      </Card.Root>
    );
  }

  return (
    <VStack
      gap={6}
      width="full"
      maxWidth="920px"
      align="start"
      paddingBottom={12}
    >
      <Card.Root>
        <Card.Header>
          <Heading size="md">Manual Topic Clustering</Heading>
        </Card.Header>
        <Card.Body>
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

      <VStack width="full" align="start" gap={6}>
        <VStack gap={2} marginTop={2} align="start" width="full">
          <Heading size="md" as="h2">
            Default Models
          </Heading>
          <Text>
            Configure the default models used on topic clustering and embeddings
          </Text>
        </VStack>
        <Card.Root width="full">
          <Card.Body width="full">
            <VStack gap={0} width="full" align="stretch">
              <TopicClusteringModel />
              <EmbeddingsModel />
            </VStack>
          </Card.Body>
        </Card.Root>
      </VStack>
    </VStack>
  );
}
