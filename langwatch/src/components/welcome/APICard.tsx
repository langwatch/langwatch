import {
  Box,
  Heading,
  VStack,
  Text,
  Spinner,
  Alert,
  HStack,
  Code,
  Spacer,
} from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { CopyInput } from "../CopyInput";
import { trackEvent } from "../../utils/tracking";
import { useIntegrationChecks } from "../IntegrationChecks";
import { LuCheckCheck } from "react-icons/lu";
import React from "react";

const getLangWatchEndpoint = () => {
  if (typeof window === "undefined") return "";
  return `${window.location.protocol}//${window.location.host}`;
};

const APICard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const { hostname } =
    typeof window !== "undefined" ? window.location : { hostname: "" };
  const integrationChecks = useIntegrationChecks();
  const hasFirstMessage = Boolean(integrationChecks.data?.firstMessage);

  return (
    <VStack
      minH="80px"
      boxShadow="sm"
      borderRadius="xl"
      bg="white"
      p={4}
      gap={2}
      align="stretch"
    >
      <Box mb={1}>
        <Heading size="md" fontWeight="bold" textAlign="left">
          Connect to LangWatch
        </Heading>
        <Text fontSize="xs" color="gray.500" textAlign="left">
          Follow the instructions on our docs to setup your project with
          LangWatch!
        </Text>
      </Box>
      <VStack align="start" gap={1} fontSize="sm" w="full" mb={1}>
        <HStack width="full" align="end">
          <VStack align="start">
            <Text fontSize="sm" color="gray.900" fontWeight="medium">
              API key
            </Text>
            <Text fontSize="xs" color="gray.500" fontWeight="normal" mt={-1}>
              Keep it secret, keep it safe. Don&apos;t let this key fall into
              prying eyes.
            </Text>
          </VStack>
          <Spacer />
          <Code
            borderRadius="6px"
            border="1px solid #EEE"
            background="gray.50"
            paddingY={1}
            paddingX={2}
          >
            LANGWATCH_API_KEY
          </Code>
        </HStack>
        <CopyInput
          value={project?.apiKey ?? ""}
          secureMode
          label="API key"
          aria-label="Copy API key"
          onClick={() =>
            trackEvent("api_key_copy", { project_id: project?.id })
          }
        />
      </VStack>
      {hostname !== "app.langwatch.ai" && (
        <VStack align="start" gap={1} fontSize="sm" w="full" mb={1}>
          <HStack width="full" align="end">
            <VStack align="start">
              <Text fontSize="sm" color="gray.900" fontWeight="medium">
                Endpoint
              </Text>
              <Text fontSize="xs" color="gray.500" fontWeight="normal" mt={-1}>
                This is the endpoint you should configure in your SDK to send
                data to LangWatch.
              </Text>
            </VStack>
            <Spacer />
            <Code
              borderRadius="6px"
              border="1px solid #EEE"
              background="gray.50"
              paddingY={1}
              paddingX={2}
            >
              LANGWATCH_ENDPOINT
            </Code>
          </HStack>
          <CopyInput
            value={getLangWatchEndpoint()}
            label="Endpoint"
            aria-label="Copy endpoint URL"
            onClick={() =>
              trackEvent("endpoint_copy", { project_id: project?.id })
            }
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
              <LuCheckCheck color="green.500" size={16} />
            </Alert.Indicator>
            <Alert.Title>Integration configured</Alert.Title>
          </Alert.Root>
        ) : (
          <Alert.Root
            size="sm"
            borderStartWidth="3px"
            borderStartColor="colorPalette.600"
            colorPalette="gray"
            title="Waiting for messages to arrive..."
          >
            <Alert.Indicator>
              <Spinner size="sm" />
            </Alert.Indicator>
            <Alert.Title>Waiting for messages to arrive...</Alert.Title>
          </Alert.Root>
        )}
      </Box>
    </VStack>
  );
};

export default APICard;
