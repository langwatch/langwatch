import { Banner } from "@langwatch/design-system/banner";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Alert,
  Box,
  Code,
  HStack,
  IconButton,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useGatewayToaster } from "../../../../behavior/gateway-feedback.ts";
import { useLentGuidedTour } from "../../../../behavior/lent-guided-tour.ts";
import { VirtualKeyUsageSnippet } from "./virtual-key-usage-snippet.tsx";

type VirtualKeySecretRevealProps = {
  open: boolean;
  onClose: () => void;
  keyName: string;
  secret: string;
  // Model string for the copy-paste usage example. Threaded from the
  // create/rotate surface (which knows the key's eligible providers) so a
  // self-hosted / custom key shows a model it can actually serve instead of
  // the OpenAI-only default.
  model?: string;
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
  model,
  kind = "create",
}: VirtualKeySecretRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const toaster = useGatewayToaster();
  // The guided tour shows the secret rather than the mask when its cursor lands on it.
  const { useRegisterActions } = useLentGuidedTour();
  const tourActions = useMemo(() => ({ revealVirtualKeySecret: () => setRevealed(true) }), []);
  useRegisterActions(tourActions);

  const clearCopiedTimer = () => window.clearTimeout(copiedTimer.current);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const handleCopy = async () => {
    clearCopiedTimer();
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      return;
    }
    setCopyFailed(false);
    setCopied(true);
    toaster.create({
      title: "Secret copied",
      description: `${keyName} copied to clipboard`,
      type: "success",
    });
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const close = () => {
    clearCopiedTimer();
    setRevealed(false);
    setCopied(false);
    setCopyFailed(false);
    setConfirmed(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={kind === "rotate" ? "Save your rotated secret" : "Save your virtual key secret"}
      size="md"
      role="alertdialog"
      dismissible={false}
      note={
        <HStack>
          <input
            type="checkbox"
            id="vk-secret-confirm"
            data-testid="gateway-virtual-key-secret-confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <label htmlFor="vk-secret-confirm">
            <Text fontSize="sm">I've saved the secret in a safe place.</Text>
          </label>
        </HStack>
      }
      primaryAction={{
        label: "Close",
        onClick: close,
        disabledReason: confirmed ? void 0 : "Confirm you've saved the secret first",
        "data-testid": "gateway-virtual-key-secret-close",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>You will only see this secret once.</Alert.Title>
            <Alert.Description>
              LangWatch stores only a hash. Copy and save the raw secret in your password manager or
              secret store before closing.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        {kind === "rotate" && (
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>24-hour grace window active.</Alert.Title>
              <Alert.Description>
                The previous secret keeps working for 24 hours so clients can roll over gradually.
                After that it hard-fails with a 401 even though this key stays active.
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
            data-tour="vk-secret"
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
                userSelect="all"
                data-testid="gateway-virtual-key-secret"
              >
                {revealed ? secret : maskSecret(secret)}
              </Code>
            </Box>
            <IconButton
              data-testid="gateway-virtual-key-secret-reveal"
              aria-label={revealed ? "Hide secret" : "Reveal secret"}
              variant="ghost"
              size="sm"
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
            <IconButton
              data-testid="gateway-virtual-key-secret-copy"
              aria-label="Copy secret"
              variant="ghost"
              size="sm"
              onClick={() => void handleCopy()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </HStack>
          {copyFailed && (
            <Banner
              status="error"
              title="Couldn't copy to the clipboard."
              data-testid="gateway-virtual-key-secret-copy-failed"
            >
              Reveal the secret and copy it by hand, or try again.
            </Banner>
          )}
        </VStack>

        <Separator />
        <VirtualKeyUsageSnippet secret={secret} model={model} />
      </VStack>
    </Dialog>
  );
}

function maskSecret(secret: string): string {
  if (secret.length <= 14) return "••••";
  const prefix = secret.slice(0, 14);
  return `${prefix}${"•".repeat(Math.max(0, secret.length - 14))}`;
}
