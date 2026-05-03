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

import { api } from "~/utils/api";

import { TileIcon } from "./TileIcon";
import type { ModelProviderConfig } from "./types";

interface Props {
  displayName: string;
  config: ModelProviderConfig;
  organizationId: string;
  iconKey?: string | null;
}

interface IssuedKey {
  label: string;
  secret: string;
  baseUrl: string;
}

export function ModelProviderTile({
  displayName,
  config,
  organizationId,
  iconKey,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(config.defaultLabel ?? "");
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
      setErrorMessage(err.message);
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
    setLabel(config.defaultLabel ?? "");
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
          iconKey={iconKey ?? config.providerKey}
          type="model_provider"
        />
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Issue your own virtual key
          </Text>
        </VStack>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </HStack>

      {expanded && !issued && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Text fontSize="sm" fontWeight="medium">
            Issue a {displayName} virtual key
          </Text>
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
            </Box>
          )}
          {config.projectSuggestionText && (
            <Box
              borderTopWidth="1px"
              borderColor="border.muted"
              paddingTop={3}
            >
              <Text fontSize="xs" color="fg.muted">
                💡 {config.projectSuggestionText}
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
