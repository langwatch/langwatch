import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { CodeBlock } from "./CodeBlock";
import { formatEnvLines } from "./utils";

/**
 * Project-scoped legacy API key (`sk-lw-...`). One per project.
 * Lives next to the PAT list on the Settings → API Key page so users can
 * manage both personal and project credentials in one spot.
 */
export function ProjectApiKeySection() {
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const apiKey = project?.apiKey ?? "";
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  return (
    <VStack gap={4} width="full" align="stretch">
      <Text fontSize="sm" color="fg.muted">
        One shared key per project, used by the SDK and older integrations
        that send traces on behalf of the project rather than a user.
      </Text>
      <HStack
        align="start"
        gap={2}
        padding={3}
        borderWidth="1px"
        borderColor="orange.emphasized"
        background="orange.subtle"
        borderRadius="md"
      >
        <Box color="orange.fg" paddingTop={0.5}>
          <AlertTriangle size={16} />
        </Box>
        <Text fontSize="sm" color="fg">
          Prefer{" "}
          <Text as="span" fontWeight="600">
            Personal Access Tokens
          </Text>{" "}
          for new integrations — they&apos;re scoped to a user, honor your
          role bindings, and can be revoked individually. Project API keys
          remain available for backwards compatibility.
        </Text>
      </HStack>
      <CodeBlock
        label=".env"
        display={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey, mask: true },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        revealedDisplay={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        copyValue={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey },
          { key: "LANGWATCH_ENDPOINT", value: endpoint },
        ])}
        copyToastTitle=".env copied to clipboard"
        ariaLabel="Copy .env contents"
      />
    </VStack>
  );
}
