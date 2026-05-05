import {
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

import { getDocsBaseUrl } from "~/utils/docsUrl";

import { TileIcon } from "./TileIcon";
import type { CodingAssistantConfig } from "./types";

/**
 * Admins typed the canonical `https://docs.langwatch.ai/...` URL when
 * curating the catalog — but on a localhost dev install where Mintlify
 * is also running locally, those clicks should land on the worktree's
 * docs preview instead of bouncing to production. Rewrite the host
 * piece transparently at render time so admin-stored URLs round-trip
 * to whichever docs host matches the user's current control plane.
 * Foreign URLs (acme-internal docs, public links the admin pasted on
 * purpose) are returned untouched.
 */
function rewriteDocsHostForLocalDev(url: string | undefined): string | undefined {
  if (!url) return url;
  const productionPrefix = "https://docs.langwatch.ai";
  if (!url.startsWith(productionPrefix)) return url;
  const base = getDocsBaseUrl();
  if (base === productionPrefix) return url;
  return base + url.slice(productionPrefix.length);
}

interface Props {
  displayName: string;
  config: CodingAssistantConfig;
  iconKey?: string | null;
}

export function CodingAssistantTile({ displayName, config, iconKey }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void navigator.clipboard.writeText(config.setupCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <TileIcon iconKey={iconKey} type="coding_assistant" />
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Coding assistant
          </Text>
        </VStack>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </HStack>

      {expanded && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Text fontSize="sm" color="fg.muted">
            Run this in your terminal:
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
              $ {config.setupCommand}
            </Code>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={copied ? "Copied" : "Copy command"}
              onClick={onCopy}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </HStack>

          {config.helperText && (
            <Text fontSize="xs" color="fg.muted">
              {config.helperText}
            </Text>
          )}

          {config.setupDocsUrl && (
            <Button
              size="xs"
              variant="outline"
              asChild
              alignSelf="start"
            >
              <a
                href={rewriteDocsHostForLocalDev(config.setupDocsUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Setup guide ↗
              </a>
            </Button>
          )}
        </VStack>
      )}
    </Box>
  );
}
