import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import type { Project } from "@prisma/client";
import { trackEvent } from "../../utils/tracking";
import { CopyInput } from "../CopyInput";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { useRegenerateApiKey } from "../../hooks/useRegenerateApiKey";
import { RegenerateApiKeyDialog } from "./RegenerateApiKeyDialog";

interface ApiKeyManagementSectionProps {
  project: Project;
}

export function ApiKeyManagementSection({
  project,
}: ApiKeyManagementSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const { regenerate, newApiKey, clearNewApiKey, isLoading } =
    useRegenerateApiKey(project.id);

  const showNewKey = newApiKey !== "";

  const handleRegenerateKey = () => {
    regenerate();
    setShowConfirmDialog(false);
  };

  const handleCloseDialog = () => {
    setShowConfirmDialog(false);
  };

  return (
    <>
      <HorizontalFormControl
        label="API Key"
        helper={
          <VStack align="start" gap={1}>
            <Text>
              Your API key is used to authenticate requests to LangWatch. Keep
              it secure and never share it publicly.
            </Text>
          </VStack>
        }
      >
        <VStack width="full" align="start" gap={3}>
          <CopyInput
            value={showNewKey ? newApiKey : project.apiKey}
            secureMode={!showNewKey}
            label="API key"
            aria-label="Copy API key"
            onClick={() =>
              trackEvent("api_key_copy", { project_id: project.id })
            }
          />

          {showNewKey && (
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

          <Button
            variant="outline"
            colorPalette="red"
            size="sm"
            onClick={() => setShowConfirmDialog(true)}
            loading={isLoading}
          >
            <LuRefreshCw size={16} />
            Regenerate API Key
          </Button>
        </VStack>
      </HorizontalFormControl>

      <RegenerateApiKeyDialog
        open={showConfirmDialog}
        onClose={handleCloseDialog}
        onConfirm={handleRegenerateKey}
        isLoading={isLoading}
      />
    </>
  );
}
