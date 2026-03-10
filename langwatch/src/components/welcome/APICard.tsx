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
import { LuCheckCheck, LuExternalLink } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { trackEvent } from "../../utils/tracking";
import { CopyableInputWithPrefix } from "../../features/onboarding/components/sections/observability/CopyableInputWithPrefix";
import { useIntegrationChecks } from "../IntegrationChecks";
import { Link } from "../ui/link";
import { toaster } from "../ui/toaster";
import ObservabilityCard from "./ObservabilityCard";

const APICard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const integrationChecks = useIntegrationChecks();
  const hasFirstMessage = Boolean(integrationChecks.data?.firstMessage);

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST ?? "";

  async function copyApiKey({
    withBashPrefix,
  }: {
    withBashPrefix: boolean;
  }): Promise<void> {
    trackEvent("api_key_copy", { project_id: project?.id });
    try {
      await navigator.clipboard.writeText(
        withBashPrefix
          ? `LANGWATCH_API_KEY=${effectiveApiKey}`
          : effectiveApiKey,
      );
      toaster.create({
        title: "Copied",
        description: "API key copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the API key. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  async function copyEndpoint({
    withBashPrefix,
  }: {
    withBashPrefix: boolean;
  }): Promise<void> {
    trackEvent("endpoint_copy", { project_id: project?.id });
    try {
      await navigator.clipboard.writeText(
        withBashPrefix
          ? `LANGWATCH_ENDPOINT=${effectiveEndpoint}`
          : effectiveEndpoint,
      );
      toaster.create({
        title: "Copied",
        description: "Endpoint copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the endpoint. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

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
      <VStack align="start" gap={1} fontSize="sm" w="full" mb={1}>
        <VStack align="start">
          <Text fontSize="sm" color="fg" fontWeight="medium">
            API key
          </Text>
          <Text fontSize="xs" color="fg.muted" fontWeight="normal" mt={-1}>
            Keep it secret, keep it safe. Don&apos;t let this key fall into
            prying eyes.
          </Text>
        </VStack>
        <CopyableInputWithPrefix
          prefix="LANGWATCH_API_KEY="
          value={effectiveApiKey}
          ariaLabel="API key"
          showVisibilityToggle
          onCopy={copyApiKey}
        />
      </VStack>
      {effectiveEndpoint &&
        effectiveEndpoint !== "https://app.langwatch.ai" && (
          <VStack align="start" gap={1} fontSize="sm" w="full" mb={1}>
            <VStack align="start">
              <Text fontSize="sm" color="fg" fontWeight="medium">
                Endpoint
              </Text>
              <Text fontSize="xs" color="fg.muted" fontWeight="normal" mt={-1}>
                This is the endpoint you should configure in your SDK to send
                data to LangWatch.
              </Text>
            </VStack>
            <CopyableInputWithPrefix
              prefix="LANGWATCH_ENDPOINT="
              value={effectiveEndpoint}
              ariaLabel="Endpoint"
              onCopy={copyEndpoint}
            />
          </VStack>
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
