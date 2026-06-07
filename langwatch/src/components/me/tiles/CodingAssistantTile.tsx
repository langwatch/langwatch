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
import { usePublicEnv } from "~/hooks/usePublicEnv";

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
  const [setupOpen, setSetupOpen] = useState(false);

  const publicEnv = usePublicEnv();
  const isSaas = Boolean(publicEnv.data?.IS_SAAS);
  const baseHost = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

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
          {/*
            Self-hosted CLIs default to app.langwatch.ai, so a self-hosted user
            must first point the CLI at their own control plane (the endpoint is
            persisted after the first login). On SaaS the wrapper auto-logs-in to
            the right place, so no separate step is shown.
          */}
          {!isSaas && (
            <>
              <Text fontSize="sm" color="fg.muted">
                First point the CLI at this instance and sign in:
              </Text>
              <CommandRow command={`langwatch login --endpoint ${baseHost}`} />
            </>
          )}

          <Text fontSize="sm" color="fg.muted">
            {isSaas ? "Run this in your terminal:" : "Then run:"}
          </Text>
          <CommandRow command={config.setupCommand} />

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

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <HStack
      gap={2}
      padding={2}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      backgroundColor="bg.subtle"
      alignItems="flex-start"
    >
      <HStack gap={1.5} flex={1} minWidth={0} alignItems="flex-start">
        {/*
          The "$" is a separate, non-selectable element (lighter than the
          command) so it reads as a shell prompt but never lands in the user's
          selection/clipboard when they copy the command by hand.
        */}
        <Text
          as="span"
          fontFamily="mono"
          fontSize="sm"
          color="fg.subtle"
          userSelect="none"
          flexShrink={0}
          aria-hidden="true"
          marginTop="-4px"
        >
          $
        </Text>
        <Code
          backgroundColor="transparent"
          fontSize="sm"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
        >
          {command}
        </Code>
      </HStack>
      <IconButton
        size="xs"
        variant="ghost"
        aria-label={copied ? "Copied" : "Copy command"}
        onClick={onCopy}
        flexShrink={0}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </HStack>
  );
}
