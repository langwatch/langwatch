import {
  Alert,
  Box,
  Heading,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { LuCheckCheck, LuExternalLink } from "react-icons/lu";
import { ApiKeyIntegrationInfoCard } from "../../features/traces-v2/onboarding/components/ApiKeyIntegrationInfoCard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useIntegrationChecks } from "../IntegrationChecks";
import { Link } from "../ui/link";
import ObservabilityCard from "./ObservabilityCard";

const APICard: React.FC = () => {
  const { project, organization } = useOrganizationTeamProject();
  const integrationChecks = useIntegrationChecks();
  const hasFirstMessage = Boolean(integrationChecks.data?.firstMessage);

  const [token, setToken] = useState<string | null>(null);

  return (
    <VStack
      minH="80px"
      boxShadow="sm"
      borderRadius="xl"
      bg="bg"
      p={4}
      gap={2}
      align="stretch"
    >
      <Box mb={1}>
        <Heading size="md" textAlign="left">
          Connect to LangWatch
        </Heading>
        <Text fontSize="xs" color="fg.muted" textAlign="left">
          Follow the instructions on our docs to setup your project with
          LangWatch!
        </Text>
      </Box>
      {project && organization && (
        <ApiKeyIntegrationInfoCard
          organizationId={organization.id}
          projectId={project.id}
          token={token}
          onTokenGenerated={setToken}
        />
      )}
      <Box mt={1}>
        {hasFirstMessage ? (
          <Alert.Root
            size="sm"
            borderStartWidth="3px"
            borderStartColor="green.500"
            colorPalette="green"
            title="Integration configured"
          >
            <Alert.Indicator>
              <LuCheckCheck size={16} />
            </Alert.Indicator>
            <Alert.Title>
              Integration configured — traces are being received
            </Alert.Title>
          </Alert.Root>
        ) : (
          <Alert.Root
            size="sm"
            borderStartWidth="3px"
            borderStartColor="orange.400"
            colorPalette="orange"
            title="Waiting for first trace..."
          >
            <Alert.Indicator>
              <Spinner size="sm" />
            </Alert.Indicator>
            <Alert.Title>Waiting for first trace...</Alert.Title>
          </Alert.Root>
        )}
      </Box>
      <Separator marginY={4} />
      <ObservabilityCard />
      {hasFirstMessage ? (
        <Alert.Root colorPalette="orange" borderRadius="md">
          <Alert.Indicator />
          <Alert.Title>
            Ready to go deeper? Set up
            <Link
              href="https://docs.langwatch.ai/evaluations"
              isExternal
              ml={1}
              textDecoration="underline"
              textDecorationStyle="dashed"
            >
              Evaluations
              <LuExternalLink />
            </Link>{" "}
            to automatically score your LLM outputs.
          </Alert.Title>
        </Alert.Root>
      ) : (
        <Alert.Root colorPalette="orange" borderRadius="md">
          <Alert.Indicator />
          <Alert.Title>
            Pick a guide above, or check our
            <Link
              href="https://docs.langwatch.ai/integration"
              isExternal
              ml={1}
              textDecoration="underline"
              textDecorationStyle="dashed"
            >
              step-by-step integration docs
              <LuExternalLink />
            </Link>{" "}
            to start sending traces.
          </Alert.Title>
        </Alert.Root>
      )}
    </VStack>
  );
};

export default APICard;
