/**
 * The target area of the run dialog: the agents as blocks, or the prompts
 * grouped under their folders when the prompt chip is chosen.
 *
 * A project with nothing to run against shows one dotted "Setup agent" box
 * that opens the agent setup.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Check,
  Code,
  FileText,
  Folder,
  Globe,
  Plug,
  Workflow,
} from "lucide-react";
import { agentHasDevTunnel } from "~/components/agents/LocalTunnelBadge";
import type { TargetValue } from "~/components/scenarios/TargetSelector";

const AGENT_ICONS = {
  http: Globe,
  code: Code,
  workflow: Workflow,
} as const;

/** An agent the run dialog can offer: one of the scenario target kinds. */
export type RunDialogAgent = {
  id: string;
  name: string;
  type: "http" | "code" | "workflow";
  config?: unknown;
};

/** One prompt as the picker lists it. */
export type PromptEntry = {
  id: string;
  handle: string | null;
  version: number;
};

/** The folder a prompt files under: its handle prefix, "default" when none. */
export function groupPromptsByFolder(
  prompts: PromptEntry[],
): { folder: string; prompts: PromptEntry[] }[] {
  const groups = new Map<string, PromptEntry[]>();
  for (const prompt of prompts) {
    const handle = prompt.handle ?? prompt.id;
    const folder = handle.includes("/")
      ? (handle.split("/")[0] ?? "default")
      : "default";
    const held = groups.get(folder);
    if (held) held.push(prompt);
    else groups.set(folder, [prompt]);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === "default") return 1;
      if (b[0] === "default") return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([folder, held]) => ({ folder, prompts: held }));
}

/** The agents of the project as blocks, the selected one marked. */
export function AgentBlocks({
  agents,
  selected,
  onSelect,
}: {
  agents: RunDialogAgent[];
  selected: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
}) {
  return (
    <Grid
      templateColumns="repeat(3, 1fr)"
      gap={2}
      data-testid="run-dialog-agents"
    >
      {agents.map((agent) => {
        const active = selected?.type !== "prompt" && selected?.id === agent.id;
        const online = agentHasDevTunnel(agent);
        const AgentIcon = AGENT_ICONS[agent.type];
        return (
          <Box
            key={agent.id}
            as="button"
            textAlign="left"
            cursor="pointer"
            borderWidth="1px"
            borderColor={active ? "blue.500" : "border"}
            background={active ? "blue.subtle" : undefined}
            _hover={{ background: active ? "blue.subtle" : "bg.muted" }}
            borderRadius="lg"
            paddingX={3}
            paddingY={2.5}
            onClick={() => onSelect({ type: agent.type, id: agent.id })}
            data-testid={`run-dialog-agent-${agent.id}`}
            aria-pressed={active}
          >
            <HStack justify="space-between">
              <AgentIcon size={14} color="var(--chakra-colors-fg-muted)" />
              {active && (
                <Check size={14} color="var(--chakra-colors-blue-500)" />
              )}
            </HStack>
            <Text fontSize="sm" fontWeight="medium" truncate marginTop={2}>
              {agent.name}
            </Text>
            {online && (
              <HStack
                gap={1.5}
                marginTop={1}
                data-testid={`agent-online-${agent.id}`}
              >
                <Box boxSize={2} borderRadius="full" background="green.500" />
                <Text fontSize="xs" color="fg.muted">
                  online
                </Text>
              </HStack>
            )}
          </Box>
        );
      })}
    </Grid>
  );
}

/** The dotted box a project with nothing to test shows in place of the list. */
export function SetupAgentBox({ onSetup }: { onSetup: () => void }) {
  return (
    <VStack
      as="button"
      cursor="pointer"
      width="full"
      gap={1}
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="lg"
      paddingY={6}
      _hover={{ background: "bg.muted" }}
      onClick={onSetup}
      data-testid="run-dialog-setup-agent"
    >
      <Plug size={16} color="var(--chakra-colors-fg-subtle)" />
      <Text fontSize="sm" fontWeight="medium">
        Setup agent
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Connect the agent you want to test
      </Text>
    </VStack>
  );
}

/** The prompts under their folders, the way the prompt list shows them. */
export function PromptPicker({
  prompts,
  selected,
  onSelect,
}: {
  prompts: PromptEntry[];
  selected: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
}) {
  const groups = groupPromptsByFolder(prompts);

  return (
    <VStack
      align="stretch"
      gap={2}
      maxHeight="240px"
      overflowY="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      padding={2}
      data-testid="run-dialog-prompts"
    >
      {groups.map((group) => (
        <VStack key={group.folder} align="stretch" gap={1}>
          {group.folder !== "default" && (
            <HStack gap={1.5} paddingX={1}>
              <Folder size={11} color="var(--chakra-colors-fg-subtle)" />
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                {group.folder}
              </Text>
            </HStack>
          )}
          {group.prompts.map((prompt) => {
            const active =
              selected?.type === "prompt" && selected.id === prompt.id;
            return (
              <HStack
                key={prompt.id}
                as="button"
                cursor="pointer"
                textAlign="left"
                borderWidth="1px"
                borderColor={active ? "blue.500" : "transparent"}
                background={active ? "blue.subtle" : undefined}
                _hover={{ background: active ? "blue.subtle" : "bg.muted" }}
                borderRadius="md"
                paddingX={3}
                paddingY={2}
                gap={2.5}
                onClick={() => onSelect({ type: "prompt", id: prompt.id })}
                data-testid={`run-dialog-prompt-${prompt.id}`}
              >
                <FileText size={14} color="var(--chakra-colors-green-500)" />
                <Text fontSize="sm" fontWeight="medium" truncate flex={1}>
                  {prompt.handle ?? prompt.id}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  v{prompt.version}
                </Text>
                {active && (
                  <Check size={14} color="var(--chakra-colors-blue-500)" />
                )}
              </HStack>
            );
          })}
        </VStack>
      ))}
      {prompts.length === 0 && (
        <Text fontSize="xs" color="fg.subtle" paddingX={1} paddingY={2}>
          No saved prompts in this project yet.
        </Text>
      )}
    </VStack>
  );
}
