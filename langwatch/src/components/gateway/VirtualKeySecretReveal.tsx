import {
  Alert,
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { VirtualKeyUsageSnippet } from "./VirtualKeyUsageSnippet";

type VirtualKeySecretRevealProps = {
  open: boolean;
  onClose: () => void;
  keyName: string;
  secret: string;
  // Distinguishes the initial-mint flow from a rotation. Rotations
  // also carry a grace-window banner (previous secret stays valid
  // for 24h so clients can roll over without a cliff).
  kind?: "create" | "rotate";
};

/**
 * Show-once secret reveal. Designed to make it nearly-impossible for a user
 * to dismiss the dialog without first acknowledging the "you will never see
 * this again" invariant.
 */
export function VirtualKeySecretReveal({
  open,
  onClose,
  keyName,
  secret,
  kind = "create",
}: VirtualKeySecretRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const close = () => {
    setRevealed(false);
    setCopied(false);
    setConfirmed(false);
    onClose();
  };

  return (
    // role="alertdialog" + closeOnInteractOutside/Escape=false prevent
    // the operator from losing the show-once secret to an accidental
    // outside-click or Escape — the only way out is the Close button
    // at the footer, which itself is gated on the "I've saved this"
    // checkbox. Cheap belt-and-suspenders vs. orphan VKs.
    <Dialog.Root
      open={open}
      onOpenChange={() => {}}
      role="alertdialog"
      closeOnInteractOutside={false}
      closeOnEscape={false}
    >
      <Dialog.Content maxWidth="560px">
          <Dialog.Header>
            <Dialog.Title>
              {kind === "rotate"
                ? "Save your rotated secret"
                : "Save your virtual key secret"}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="stretch" gap={4}>
              <Alert.Root status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>You will only see this secret once.</Alert.Title>
                  <Alert.Description>
                    LangWatch stores only a hash. Copy and save the raw secret
                    in your password manager or secret store before closing.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
              {kind === "rotate" && (
                <Alert.Root status="info">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>24-hour grace window active.</Alert.Title>
                    <Alert.Description>
                      The previous secret keeps working for 24 hours so
                      clients can roll over gradually. After that it hard-
                      fails with a 401 even though this key stays active.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              <VStack align="start" gap={1}>
                <Text fontSize="sm" color="fg.muted">
                  Virtual key name
                </Text>
                <Text fontWeight="medium">{keyName}</Text>
              </VStack>

              <VStack align="stretch" gap={2}>
                <Text fontSize="sm" color="fg.muted">
                  Secret
                </Text>
                <HStack
                  border="1px solid"
                  borderColor="border.subtle"
                  borderRadius="md"
                  padding={2}
                  gap={2}
                >
                  <Box flex={1} overflowX="auto">
                    <Code
                      fontSize="sm"
                      bg="transparent"
                      paddingX={0}
                      whiteSpace="nowrap"
                    >
                      {revealed ? secret : maskSecret(secret)}
                    </Code>
                  </Box>
                  <IconButton
                    aria-label={revealed ? "Hide secret" : "Reveal secret"}
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </IconButton>
                  <IconButton
                    aria-label="Copy secret"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </IconButton>
                </HStack>
              </VStack>

              <Separator />
              <VirtualKeyUsageSnippet secret={secret} />
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack width="full" gap={4}>
              <HStack>
                <input
                  type="checkbox"
                  id="vk-secret-confirm"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <label htmlFor="vk-secret-confirm">
                  <Text fontSize="sm">
                    I've saved the secret in a safe place.
                  </Text>
                </label>
              </HStack>
              <Box flex={1} />
              <Button
                colorPalette="orange"
                onClick={close}
                disabled={!confirmed}
              >
                Close
              </Button>
            </HStack>
          </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function maskSecret(secret: string): string {
  if (secret.length <= 14) return "••••";
  const prefix = secret.slice(0, 14);
  return `${prefix}${"•".repeat(Math.max(0, secret.length - 14))}`;
}
