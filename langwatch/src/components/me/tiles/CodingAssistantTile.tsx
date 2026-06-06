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

import { Dialog } from "~/components/ui/dialog";

import { InstallCliCard } from "../InstallCliCard";
import { TileIcon } from "./TileIcon";
import type { CodingAssistantConfig } from "./types";

interface Props {
  displayName: string;
  config: CodingAssistantConfig;
  iconAsset?: string | null;
  iconKey?: string | null;
}

export function CodingAssistantTile({
  displayName,
  config,
  iconAsset,
  iconKey,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

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
      <HStack cursor="pointer" onClick={() => setExpanded(!expanded)} gap={3}>
        <TileIcon
          iconAsset={iconAsset}
          iconKey={iconKey}
          type="coding_assistant"
        />
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

          <HStack gap={2} fontSize="xs" color="fg.muted">
            <Text>New to LangWatch?</Text>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setSetupOpen(true)}
            >
              Setup guide
            </Button>
          </HStack>
        </VStack>
      )}

      <Dialog.Root
        open={setupOpen}
        onOpenChange={(d) => setSetupOpen(d.open)}
        size="md"
        modal
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Set up LangWatch</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body paddingBottom={6}>
            <InstallCliCard />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
