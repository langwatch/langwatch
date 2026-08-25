import { Alert, Button, Code, HStack, VStack } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";

/**
 * Shows a webhook signing secret exactly once, right after create or
 * roll-secret. There is no read-back path: closing this dialog is the last
 * time the plaintext exists outside the receiver's config.
 */
export function WebhookSecretDialog({
  secret,
  onClose,
}: {
  /** Open while non-null. */
  secret: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(secret ?? "");
        setCopied(true);
        toaster.create({
          title: "Signing secret copied",
          type: "success",
        });
      } catch {
        // The secret never shows again, so a silent copy failure is the
        // worst outcome: say it failed and leave the value on screen.
        toaster.create({
          title: "Copy failed. Select the secret and copy it manually.",
          type: "error",
        });
      }
    })();
  };

  return (
    <Dialog.Root
      open={secret !== null}
      onOpenChange={({ open }) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <Dialog.Content bg="bg" data-testid="webhook-secret-dialog">
        <Dialog.Header>
          <Dialog.Title>Signing secret</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack align="start" gap={4}>
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Copy this secret now. It is shown only once; if it is lost, roll the
                  secret to get a new one.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
            <HStack width="full" gap={2}>
              <Code
                flex={1}
                padding={2}
                fontSize="sm"
                wordBreak="break-all"
                data-testid="webhook-secret-value"
              >
                {secret}
              </Code>
              <Button size="sm" onClick={copy} variant="outline">
                <Copy size={14} />
                {copied ? "Copied" : "Copy"}
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
