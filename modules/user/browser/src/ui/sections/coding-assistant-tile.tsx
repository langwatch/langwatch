import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Button,
  Code,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

import { usePersonalDeployment } from "../../behavior/personal-workspace-session.ts";
import type { AiToolConfigOf } from "../../model/ai-tool-config.ts";
import { InstallCliCard } from "../blocks/install-cli-card.tsx";
import { TileIcon } from "../elements/tile-icon.tsx";

interface Props {
  displayName: string;
  config: AiToolConfigOf<"coding_assistant">;
  iconAsset?: string | null;
  iconKey?: string | null;
}

export function CodingAssistantTile({ displayName, config, iconAsset, iconKey }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const { isSaas, appBaseUrl } = usePersonalDeployment();

  return (
    <>
      <Card
        titleLevel={3}
        icon={<TileIcon iconAsset={iconAsset} iconKey={iconKey} type="coding_assistant" />}
        title={displayName}
        description="Coding assistant"
        actions={
          <IconButton
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} setup for ${displayName}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </IconButton>
        }
      >
        {expanded ? (
          <VStack align="stretch" gap={3}>
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
                <CommandRow command={`langwatch login --endpoint ${appBaseUrl}`} />
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
              <Button size="xs" variant="outline" onClick={() => setSetupOpen(true)}>
                Setup guide
              </Button>
            </HStack>
          </VStack>
        ) : null}
      </Card>
      <Dialog open={setupOpen} onClose={() => setSetupOpen(false)} title="Set up LangWatch">
        <InstallCliCard />
      </Dialog>
    </>
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
    <Card variant="nested" padding="sm">
      <HStack gap={2} alignItems="flex-start">
        <HStack gap={1.5} flex={1} minWidth={0} alignItems="baseline">
          {/*
          The "$" is a separate, non-selectable element (lighter than the
          command) so it reads as a shell prompt but never lands in the user's
          selection/clipboard when they copy the command by hand. Baseline
          alignment sits it on the command's first line; a touch of left
          indent gives the prompt some breathing room from the box edge.
        */}
          <Text
            as="span"
            fontFamily="mono"
            fontSize="sm"
            color={{ base: "fg.subtle", _dark: "fg.muted" }}
            userSelect="none"
            flexShrink={0}
            aria-hidden="true"
            marginLeft={1}
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
    </Card>
  );
}
