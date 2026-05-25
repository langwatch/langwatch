import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

export const ACCOUNT_ERROR_MESSAGE_MAX = 500;

/**
 * Claude Code (and other agent clients) overlay their own "Add funds /
 * billing" affordance when the error message pattern-matches a provider
 * billing phrase, overriding whatever text we send. So a governance
 * message containing these words would be silently replaced by the
 * client's own billing link, which is exactly wrong for a governed user
 * who cannot fund the org's provider account. Warn the admin so they
 * reword. Empirically verified: "credit balance" triggers the override;
 * "quota / exhausted / limit / blocked" do not.
 */
export function containsBillingTriggerPhrase(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("credit") || lower.includes("billing");
}

/**
 * Org-admin control for the governance error message the gateway shows end
 * users when it blocks a request for an account-level reason they cannot
 * self-resolve: the org's gateway spending limit is reached (our own 402),
 * or the org's provider account is exhausted (an upstream credit/quota
 * terminal error). Empty = the provider's verbatim error is forwarded
 * unchanged. When set, the gateway swaps only the human-facing message,
 * preserving HTTP status + error type + retry headers so client retry
 * semantics are unchanged.
 *
 * Spec: specs/ai-gateway/governance/governance-error-messaging.feature
 */
export function GovernanceErrorMessageSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const policyQuery = api.sessionPolicy.get.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const setMutation = api.sessionPolicy.setAccountErrorMessage.useMutation({
    onSuccess: () => {
      void utils.sessionPolicy.get.invalidate({ organizationId });
      toaster.create({ title: "Governance message saved", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to save",
        description: err.message,
        type: "error",
      });
    },
  });

  const persisted = policyQuery.data?.accountErrorMessage ?? "";
  const [value, setValue] = useState<string>("");

  // Sync the editable value to the persisted string whenever the server
  // value changes (initial load, or refetch after a save). Keyed on the
  // string itself so local typing is never clobbered by an unrelated
  // re-render.
  useEffect(() => {
    setValue(persisted);
  }, [persisted]);

  const trimmed = value.trim();
  const isTooLong = value.length > ACCOUNT_ERROR_MESSAGE_MAX;
  const isDirty = trimmed !== persisted && !isTooLong;
  const hasTrigger = containsBillingTriggerPhrase(value);

  const onSave = () => {
    if (!organizationId || isTooLong) return;
    setMutation.mutate({ organizationId, message: value });
  };
  const onReset = () => setValue(persisted);

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={5}>
      <VStack align="start" gap={1} marginBottom={3}>
        <HStack gap={2}>
          <Heading as="h3" size="sm">
            Governance error message
          </Heading>
          {persisted ? (
            <Badge variant="surface" colorPalette="orange" size="sm">
              active
            </Badge>
          ) : (
            <Badge variant="surface" colorPalette="gray" size="sm">
              not set
            </Badge>
          )}
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          Shown to end users when the gateway blocks a request for an
          account-level reason they cannot fix themselves: your gateway
          spending limit is reached, or the provider account behind a key is
          exhausted. Leave empty to forward the provider's own error message
          unchanged.
        </Text>
      </VStack>

      <VStack align="stretch" gap={3}>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your organization's AI gateway access is currently blocked. Contact your LangWatch admin."
          rows={3}
          size="sm"
          borderColor={isTooLong ? "red.300" : undefined}
        />

        <HStack justify="space-between" align="center">
          <Text fontSize="xs" color={isTooLong ? "red.600" : "fg.muted"}>
            {value.length} / {ACCOUNT_ERROR_MESSAGE_MAX}
          </Text>
          <HStack gap={2}>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReset}
              disabled={!isDirty || setMutation.isPending}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              loading={setMutation.isPending}
              disabled={!isDirty}
            >
              Save
            </Button>
          </HStack>
        </HStack>

        {hasTrigger && (
          <HStack
            align="start"
            gap={2}
            borderWidth="1px"
            borderColor="yellow.300"
            backgroundColor="yellow.50"
            borderRadius="sm"
            padding={3}
          >
            <Box color="yellow.600" paddingTop="2px" flexShrink={0}>
              <AlertTriangle size={16} />
            </Box>
            <Text fontSize="xs" color="yellow.800">
              This message mentions "credit" or "billing". Claude Code and some
              other clients detect those words and replace your message with
              their own billing link, so your text will not be shown. Reword
              without "credit" or "billing" (for example "spending limit
              reached" or "quota exhausted, contact your admin").
            </Text>
          </HStack>
        )}

        <Text fontSize="xs" color="fg.muted">
          The gateway swaps only the message text. The HTTP status, error
          type, and retry headers are forwarded unchanged, so a client still
          treats a terminal error as terminal and a retryable one as
          retryable.
        </Text>
      </VStack>
    </Box>
  );
}
