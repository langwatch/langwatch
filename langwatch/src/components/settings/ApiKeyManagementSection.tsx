import { Alert, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import type { Project } from "@prisma/client";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { CopyInput } from "../CopyInput";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { HorizontalFormControl } from "../HorizontalFormControl";

interface ApiKeyManagementSectionProps {
  project: Project;
}


export function ApiKeyManagementSection({
  project,
}: ApiKeyManagementSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const apiContext = api.useContext();

  const regenerateApiKey = api.project.regenerateApiKey.useMutation({
    onSuccess: (data) => {
      setNewApiKey(data.apiKey);
      setShowNewKey(true);
      setShowConfirmDialog(false);
      void apiContext.organization.getAll.invalidate();

      toaster.create({
        title: "API Key Regenerated",
        description:
          "Your old API key has been invalidated. Make sure to update your applications.",
        type: "danger",
        meta: { closable: true },
      });
    },
    onError: () => {
      toaster.create({
        title: "Failed to regenerate API key",
        description: "Please try again or contact support",
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const handleRegenerateKey = () => {
    regenerateApiKey.mutate({ projectId: project.id });
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
            loading={regenerateApiKey.isLoading}
          >
            <LuRefreshCw size={16} />
            Regenerate API Key
          </Button>
        </VStack>
      </HorizontalFormControl>

      <Dialog.Root
        open={showConfirmDialog}
        onOpenChange={({ open }) => setShowConfirmDialog(open)}
        placement="center"
      >
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title>Regenerate API Key?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="start" gap={4}>
              <Text>
                This will invalidate your current API key immediately. Any
                applications or services using the old key will stop working.
              </Text>
              <Alert.Root status="error" borderRadius="md">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>This action cannot be undone</Alert.Title>
                  <Alert.Description>
                    You&apos;ll need to update all applications using this API
                    key.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
            >
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={handleRegenerateKey}
              loading={regenerateApiKey.isLoading}
            >
              Regenerate Key
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
