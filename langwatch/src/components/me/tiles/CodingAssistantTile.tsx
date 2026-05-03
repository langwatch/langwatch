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

import type { CodingAssistantConfig } from "./types";

interface Props {
  displayName: string;
  config: CodingAssistantConfig;
}

export function CodingAssistantTile({ displayName, config }: Props) {
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
                href={config.setupDocsUrl}
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
