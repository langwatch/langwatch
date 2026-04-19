import { Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";
import { CodeBlock } from "./CodeBlock";
import { formatEnvLines, maskSecret } from "./utils";

/**
 * One-time display for a newly created PAT. Shows the raw token plus
 * ready-to-paste .env and Authorization header snippets, all driven by the
 * same `newToken` value so they stay in sync.
 */
export function TokenCreatedDialog({
  newToken,
  projectId,
  endpoint,
  onClose,
}: {
  newToken: string | null;
  projectId?: string;
  endpoint: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      size="xl"
      open={!!newToken}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Token Created</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={5} align="stretch">
            <Text color="orange.500" fontWeight="600">
              Copy this token now. You won&apos;t be able to see it again.
            </Text>
            {newToken && (
              <CodeBlock
                label=".env"
                display={formatEnvLines([
                  { key: "LANGWATCH_API_KEY", value: newToken, mask: true },
                  {
                    key: "LANGWATCH_PROJECT_ID",
                    value: projectId ?? "<your-project-id>",
                  },
                  { key: "LANGWATCH_ENDPOINT", value: endpoint },
                ])}
                revealedDisplay={formatEnvLines([
                  { key: "LANGWATCH_API_KEY", value: newToken },
                  {
                    key: "LANGWATCH_PROJECT_ID",
                    value: projectId ?? "<your-project-id>",
                  },
                  { key: "LANGWATCH_ENDPOINT", value: endpoint },
                ])}
                copyValue={formatEnvLines([
                  { key: "LANGWATCH_API_KEY", value: newToken },
                  {
                    key: "LANGWATCH_PROJECT_ID",
                    value: projectId ?? "<your-project-id>",
                  },
                  { key: "LANGWATCH_ENDPOINT", value: endpoint },
                ])}
                copyToastTitle=".env copied to clipboard"
                ariaLabel="Copy .env contents"
              />
            )}

            <VStack gap={2} align="stretch" width="full">
              <Text fontWeight="600" fontSize="sm">
                How to use this token
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Send the token on every request using one of the two options
                below. Both carry the project context LangWatch needs to
                route traces and enforce permissions.
              </Text>
            </VStack>

            <VStack gap={2} align="stretch" width="full">
              <Text fontWeight="600" fontSize="sm">
                Option 1 — Bearer token
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Use the <code>Authorization</code> header plus{" "}
                <code>X-Project-Id</code>:
              </Text>
              <CodeBlock
                label="http"
                display={`Authorization: Bearer ${
                  newToken ? maskSecret(newToken) : "pat-lw-..."
                }\nX-Project-Id: ${projectId ?? "<your-project-id>"}`}
                revealedDisplay={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${
                  projectId ?? "<your-project-id>"
                }`}
                copyValue={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${
                  projectId ?? "<your-project-id>"
                }`}
                copyToastTitle="Bearer headers copied"
                ariaLabel="Copy Bearer headers"
              />
            </VStack>

            <VStack gap={2} align="stretch" width="full">
              <Text fontWeight="600" fontSize="sm">
                Option 2 — Basic Auth (SDK clients)
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Encode the project ID and token as{" "}
                <code>base64(projectId:token)</code>:
              </Text>
              <CodeBlock
                label="http"
                display={`Authorization: Basic base64(${
                  projectId ?? "<your-project-id>"
                }:pat-lw-...)`}
                revealedDisplay={
                  newToken && projectId
                    ? `Authorization: Basic ${btoa(
                        `${projectId}:${newToken}`,
                      )}`
                    : ""
                }
                copyValue={
                  newToken && projectId
                    ? `Authorization: Basic ${btoa(
                        `${projectId}:${newToken}`,
                      )}`
                    : ""
                }
                copyToastTitle="Basic Auth header copied"
                ariaLabel="Copy Basic Auth header"
              />
            </VStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
