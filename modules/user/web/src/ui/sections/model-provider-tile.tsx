import { Box, Button, Code, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { Link } from "../elements/personal-link.tsx";
import { TileIcon } from "../elements/tile-icon.tsx";
import type { AiToolConfigOf } from "../../model/ai-tool-config.ts";

/**
 * Personal-VK label rules (mirrors `PersonalVirtualKeyTrpcApi.issuePersonal`
 * Zod regex `/^[a-z0-9][a-z0-9_\-]*$/`). Admins fill `defaultLabel` freeform,
 * so sanitise here: spaces become dashes ("Anthropic key" → "anthropic-key").
 */
function sanitizeDefaultLabel(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[^a-z0-9]+/, "");
}

const VOWEL_SOUNDS = ["a", "e", "i", "o", "u"];
function articleFor(word: string): "a" | "an" {
  const first = word.trim().charAt(0).toLowerCase();
  return VOWEL_SOUNDS.includes(first) ? "an" : "a";
}

interface Props {
  displayName: string;
  config: AiToolConfigOf<"model_provider">;
  organizationId: string;
  iconAsset?: string | null;
  iconKey?: string | null;
  /**
   * Whether a ModelProvider is configured for this provider key.
   * Defaults to true; shows "not configured" hint when false.
   */
  providerConfigured?: boolean;
}

interface IssuedKey {
  label: string;
  secret: string;
  baseUrl: string;
}

/**
 * tRPC's Zod input-validation errors arrive as the raw JSON-stringified
 * ZodError array; end users shouldn't see that shape, so extract the
 * human-readable `message` field(s), falling back to the raw string (Ariana QA G31).
 */
function humanizeZodMessage(raw: string): string {
  const trimmed = raw.trim();
  const looksLikeJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  if (!looksLikeJson) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    const issues = Array.isArray(parsed) ? parsed : [parsed];
    const messages = issues
      .map((i: { message?: unknown }) => (typeof i?.message === "string" ? i.message : null))
      .filter((m): m is string => !!m);
    return messages.length ? messages.join(". ") : raw;
  } catch {
    return raw;
  }
}

export function ModelProviderTile({
  displayName,
  config,
  organizationId,
  iconAsset,
  iconKey,
  providerConfigured = true,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(sanitizeDefaultLabel(config.defaultLabel));
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const issueMutation = api.personalVirtualKeys.issuePersonal.useMutation({
    onSuccess: (result) => {
      setIssued({
        label: result.label,
        secret: result.secret,
        baseUrl: result.baseUrl,
      });
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(humanizeZodMessage(err.message));
    },
  });

  const onIssue = () => {
    if (!label.trim() || !organizationId) return;
    setErrorMessage(null);
    issueMutation.mutate({
      organizationId,
      label: label.trim(),
      routingPolicyId: config.suggestedRoutingPolicyId,
    });
  };

  const issuing = issueMutation.isPending;

  const onCopySecret = () => {
    if (!issued) return;
    void navigator.clipboard.writeText(issued.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onReset = () => {
    setIssued(null);
    setLabel(sanitizeDefaultLabel(config.defaultLabel));
    setSecretRevealed(false);
    setErrorMessage(null);
  };

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={4} width="full">
      <HStack cursor="pointer" onClick={() => setExpanded(!expanded)} gap={3}>
        <TileIcon
          iconAsset={iconAsset}
          iconKey={iconKey ?? config.providerKey}
          type="model_provider"
        />
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text fontSize="xs" color={providerConfigured ? "fg.muted" : "orange.700"}>
            {providerConfigured ? "Issue your own virtual key" : "Provider not configured"}
          </Text>
        </VStack>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </HStack>

      {expanded && !providerConfigured && (
        <Box
          marginTop={4}
          padding={3}
          borderWidth="1px"
          borderColor="orange.200"
          borderRadius="sm"
          backgroundColor="orange.50"
        >
          <Text fontSize="sm" color="orange.900" marginBottom={2}>
            Your organization doesn&apos;t have {articleFor(displayName)} {displayName} credential
            configured yet, so issuing a key here would mint a VK that fails on first call with{" "}
            <Code fontSize="xs" backgroundColor="transparent">
              provider_error
            </Code>
            .
          </Text>
          <Text fontSize="xs" color="orange.800">
            Ask your organization admin to add {articleFor(displayName)} {displayName} provider in{" "}
            <Link
              href="/settings/model-providers"
              color="orange.800"
              fontWeight="medium"
              textDecoration="underline"
            >
              Settings → Model Providers
            </Link>
            . They&apos;ll also need to bind it into the{" "}
            <Link
              href="/gateway/routing-policies"
              color="orange.800"
              fontWeight="medium"
              textDecoration="underline"
            >
              default routing policy
            </Link>{" "}
            so personal keys can route to it.
          </Text>
        </Box>
      )}

      {expanded && providerConfigured && !issued && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Text fontSize="sm" fontWeight="medium">
            Issue {articleFor(displayName)} {displayName} virtual key
          </Text>
          {config.projectSuggestionText && (
            <Box
              padding={3}
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="sm"
              backgroundColor="bg.subtle"
            >
              <Text fontSize="xs" color="fg.muted">
                💡 {config.projectSuggestionText}
              </Text>
            </Box>
          )}
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              Label
            </Text>
            <Input
              size="sm"
              placeholder="my-app"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={issuing}
            />
          </VStack>
          <HStack gap={2}>
            <Button size="sm" onClick={onIssue} disabled={!label.trim() || issuing}>
              {issuing ? "Issuing…" : "Issue key"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
          </HStack>
          {errorMessage && (
            <Box
              padding={2}
              borderWidth="1px"
              borderColor="red.300"
              borderRadius="sm"
              backgroundColor="red.50"
            >
              <Text fontSize="xs" color="red.700">
                {errorMessage}
              </Text>
            </Box>
          )}
        </VStack>
      )}

      {expanded && issued && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Text fontSize="sm" fontWeight="medium" color="green.fg">
            ✅ {displayName} key issued
          </Text>
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              Label
            </Text>
            <Text fontSize="sm">{issued.label}</Text>
          </VStack>
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              Secret (shown once — copy now)
            </Text>
            <HStack
              gap={2}
              padding={2}
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="sm"
              backgroundColor="bg.subtle"
            >
              <Code flex={1} backgroundColor="transparent" fontSize="sm">
                {secretRevealed ? issued.secret : issued.secret.slice(0, 14) + "…"}
              </Code>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={secretRevealed ? "Hide secret" : "Reveal secret"}
                onClick={() => setSecretRevealed(!secretRevealed)}
              >
                {secretRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
              </IconButton>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={copied ? "Copied" : "Copy secret"}
                onClick={onCopySecret}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            </HStack>
          </VStack>
          <VStack align="stretch" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              Base URL
            </Text>
            <Code fontSize="sm" padding={2} borderRadius="sm">
              {issued.baseUrl}
            </Code>
          </VStack>
          <Button size="xs" variant="ghost" onClick={onReset} alignSelf="end">
            Issue another
          </Button>
        </VStack>
      )}
    </Box>
  );
}
