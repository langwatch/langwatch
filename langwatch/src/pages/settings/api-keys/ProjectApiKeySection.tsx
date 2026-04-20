import { Alert, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import { RegenerateApiKeyDialog } from "../../../components/settings/RegenerateApiKeyDialog";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { useRegenerateApiKey } from "../../../hooks/useRegenerateApiKey";
import { CodeBlock } from "./CodeBlock";
import { formatEnvLines } from "./utils";

/**
 * Project-scoped legacy API key (`sk-lw-...`). One per project.
 * Lives next to the PAT list on the Settings → API Key page so users can
 * manage both personal and project credentials in one spot.
 *
 * Owns the regenerate flow that previously lived in
 * `ApiKeyManagementSection` on the generic /settings page — consolidating
 * both views into a single source of truth for API-key management.
 */
export function ProjectApiKeySection() {
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";
  const projectId = project?.id ?? "";
  const { regenerate, newApiKey, isLoading } = useRegenerateApiKey(projectId);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // After regeneration, prefer the freshly-issued key in the UI so the user
  // can copy it before navigating away. Falls back to the persisted key.
  const apiKey = newApiKey || project?.apiKey || "";
  const wasJustRegenerated = newApiKey !== "";

  const handleConfirmRegenerate = () => {
    regenerate();
    setShowConfirmDialog(false);
  };

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
        borderColor="blue.emphasized"
        background="blue.subtle"
        borderRadius="md"
      >
        <Box color="blue.fg" paddingTop={0.5}>
          <Info size={16} />
        </Box>
        <Text fontSize="sm" color="fg">
          Prefer{" "}
          <Text as="span" fontWeight="600">
            Personal Access Tokens
          </Text>{" "}
          for new integrations — they&apos;re scoped to a user, honor your
          role bindings, and can be revoked individually.
        </Text>
      </HStack>
      <CodeBlock
        label=".env"
        display={formatEnvLines([
          { key: "LANGWATCH_API_KEY", value: apiKey, mask: !wasJustRegenerated },
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
      {wasJustRegenerated && (
        <Alert.Root status="error" borderRadius="md">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>New API Key Generated</Alert.Title>
            <Alert.Description>
              Your old API key has been invalidated and will no longer work.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      <HStack>
        <Button
          variant="outline"
          colorPalette="red"
          size="sm"
          onClick={() => setShowConfirmDialog(true)}
          loading={isLoading}
          disabled={!projectId}
        >
          <LuRefreshCw size={16} />
          Regenerate API Key
        </Button>
      </HStack>
      <RegenerateApiKeyDialog
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleConfirmRegenerate}
        isLoading={isLoading}
      />
    </VStack>
  );
}
