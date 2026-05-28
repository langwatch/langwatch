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

import { IngestionTemplateInstallDrawer } from "~/components/me/IngestionTemplateInstallDrawer";
import { usePersonalIngestionBinding } from "~/components/me/usePersonalIngestionBinding";
import { Dialog } from "~/components/ui/dialog";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { InstallCliCard } from "../InstallCliCard";
import { TileIcon } from "./TileIcon";
import type { CodingAssistantConfig } from "./types";

interface Props {
  displayName: string;
  config: CodingAssistantConfig;
  iconAsset?: string | null;
  iconKey?: string | null;
  /**
   * Catalog slug — drives surface-specific UX. Only `claude-code` gets the
   * "send your existing usage to LangWatch" trace-ingest section, which
   * mints the caller's personal ingestion binding and shows a working
   * endpoint + token (no admin handoff). Other assistants surface the bare
   * wrapper-command flow.
   */
  slug?: string;
}

export function CodingAssistantTile({
  displayName,
  config,
  iconAsset,
  iconKey,
  slug,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const isClaudeCode = slug === "claude-code";

  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const binding = usePersonalIngestionBinding({
    organizationId: orgId,
    // The Trace Ingest catalog seeds this template under the `claude_code`
    // slug; the tool-catalog tile carries the dashed `claude-code` slug.
    slug: "claude_code",
    enabled: isClaudeCode && expanded,
  });

  const onCopy = () => {
    void navigator.clipboard.writeText(config.setupCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openIngest = () => {
    setIngestOpen(true);
    if (!binding.hasExistingBinding && !binding.installResult) {
      void binding.install();
    }
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

          {isClaudeCode && binding.template && (
            <Box
              marginTop={2}
              paddingTop={3}
              borderTop="1px solid"
              borderColor="border.muted"
            >
              <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                Already using Claude Code?
              </Text>
              <Text fontSize="xs" color="fg.muted" marginBottom={2}>
                Send its usage to your personal workspace and see cost,
                tokens, and model on every request, no change to how you call
                the API.
              </Text>
              <Button size="xs" variant="outline" onClick={openIngest}>
                Connect Claude Code
              </Button>
            </Box>
          )}
        </VStack>
      )}

      {isClaudeCode && binding.template && (
        <IngestionTemplateInstallDrawer
          open={ingestOpen}
          onOpenChange={(next) => setIngestOpen(next)}
          template={{
            slug: binding.template.slug,
            displayName: binding.template.displayName,
            description: binding.template.description,
            credentialSchema: binding.template.credentialSchema,
          }}
          installResult={binding.installResult}
          isInstalling={binding.isInstalling}
          installError={binding.installError}
          hasExistingBinding={binding.hasExistingBinding}
          onInstall={() => void binding.install()}
          onRotate={() => void binding.rotate()}
          onMarkInstalled={() => setIngestOpen(false)}
        />
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
