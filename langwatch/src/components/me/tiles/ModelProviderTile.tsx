import {
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState } from "react";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

import { TileIcon } from "./TileIcon";
import type { ModelProviderConfig } from "./types";

/**
 * Personal-VK label rules (mirrors `personalVirtualKeysRouter.issuePersonal`
 * Zod regex `/^[a-z0-9][a-z0-9_\-]*$/`): lowercase alphanumeric with dashes
 * or underscores, no spaces, must start with alnum. Admins fill the
 * catalog `defaultLabel` freeform — sanitise on the user side so spaces
 * become dashes ("Anthropic key" → "anthropic-key") instead of failing
 * the user's first issue attempt with a regex error.
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

const NO_DEFAULT_POLICY_HINT =
  "no default routing policy"; // matches `NoDefaultRoutingPolicyError.message` (lowercased compare)

interface Props {
  displayName: string;
  config: ModelProviderConfig;
  organizationId: string;
  iconAsset?: string | null;
  iconKey?: string | null;
  /**
   * Whether the org has at least one ModelProvider row configured for
   * this tile's `providerKey` at any scope visible to the calling user.
   * When false, we replace the issue form with an actionable
   * "Provider not configured" hint instead of letting the user mint a
   * VK that 502s on first curl with `provider_error`. Computed once at
   * the portal level and threaded through (one query per portal load,
   * not per tile). Defaults to `true` so the form still renders if the
   * preflight query is in-flight or fails open.
   */
  providerConfigured?: boolean;
}

interface IssuedKey {
  label: string;
  secret: string;
  baseUrl: string;
}

/**
 * tRPC's Zod input-validation errors arrive on the client as the raw
 * JSON-stringified ZodError array (e.g. `[{"validation":"regex",...,
 * "message":"Label must be lowercase..."}]`). End users shouldn't see
 * that shape — extract the human-readable `message` field(s). Falls
 * back to the raw string on shapes we don't recognise so we never lose
 * information. Surfaced as Ariana QA finding G31.
 */
function humanizeZodMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    const issues = Array.isArray(parsed) ? parsed : [parsed];
    const messages = issues
      .map((i: { message?: unknown }) =>
        typeof i?.message === "string" ? i.message : null,
      )
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
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      width="full"
    >
      <HStack
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        gap={3}
      >
        <TileIcon
          iconAsset={iconAsset}
          iconKey={iconKey ?? config.providerKey}
          type="model_provider"
        />
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text
            fontSize="xs"
            color={providerConfigured ? "fg.muted" : "orange.700"}
          >
            {providerConfigured
              ? "Issue your own virtual key"
              : "Provider not configured"}
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
            Your organization doesn&apos;t have {articleFor(displayName)}{" "}
            {displayName} credential configured yet, so issuing a key here
            would mint a VK that fails on first call with{" "}
            <Code fontSize="xs" backgroundColor="transparent">
              provider_error
            </Code>
            .
          </Text>
          <Text fontSize="xs" color="orange.800">
            Ask your organization admin to add {articleFor(displayName)}{" "}
            {displayName} provider in{" "}
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
              href="/settings/routing-policies"
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
            <Button
              size="sm"
              onClick={onIssue}
              disabled={!label.trim() || issuing}
            >
              {issuing ? "Issuing…" : "Issue key"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(false)}
            >
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
              {errorMessage.toLowerCase().includes(NO_DEFAULT_POLICY_HINT) && (
                <Text fontSize="xs" color="red.700" marginTop={1}>
                  <Link
                    href="/settings/routing-policies"
                    color="red.700"
                    fontWeight="medium"
                  >
                    Configure routing policy →
                  </Link>{" "}
                  <Text as="span" color="fg.muted">
                    (admin only — non-admins should ask their organization
                    admin to publish a default)
                  </Text>
                </Text>
              )}
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
                {secretRevealed
                  ? issued.secret
                  : issued.secret.slice(0, 14) + "…"}
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
