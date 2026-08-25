/**
 * The prompts of the project, grouped under their handle folders the way the
 * prompt list shows them.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { HStack, Text, VStack } from "@chakra-ui/react";
import { Check, FileText, Folder } from "lucide-react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";

/** One prompt as the picker lists it. */
export type PromptEntry = {
  id: string;
  handle: string | null;
  version: number;
};

type PromptSelect = (target: NonNullable<TargetValue>) => void;

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

/** One prompt row: its handle, its version, and a tick when it is chosen. */
function PromptRow({
  prompt,
  isActive,
  onSelect,
}: {
  prompt: PromptEntry;
  isActive: boolean;
  onSelect: PromptSelect;
}) {
  return (
    <HStack
      as="button"
      cursor="pointer"
      textAlign="left"
      borderWidth="1px"
      borderColor={isActive ? "blue.500" : "transparent"}
      background={isActive ? "blue.subtle" : undefined}
      _hover={{ background: isActive ? "blue.subtle" : "bg.muted" }}
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
      {isActive && <Check size={14} color="var(--chakra-colors-blue-500)" />}
    </HStack>
  );
}

/** One folder of prompts, headed by its name unless it is the default one. */
function PromptFolderGroup({
  folder,
  prompts,
  selected,
  onSelect,
}: {
  folder: string;
  prompts: PromptEntry[];
  selected: TargetValue;
  onSelect: PromptSelect;
}) {
  return (
    <VStack align="stretch" gap={1}>
      {folder !== "default" && (
        <HStack gap={1.5} paddingX={1}>
          <Folder size={11} color="var(--chakra-colors-fg-subtle)" />
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            {folder}
          </Text>
        </HStack>
      )}
      {prompts.map((prompt) => (
        <PromptRow
          key={prompt.id}
          prompt={prompt}
          isActive={selected?.type === "prompt" && selected.id === prompt.id}
          onSelect={onSelect}
        />
      ))}
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
  onSelect: PromptSelect;
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
        <PromptFolderGroup
          key={group.folder}
          folder={group.folder}
          prompts={group.prompts}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {prompts.length === 0 && (
        <Text fontSize="xs" color="fg.subtle" paddingX={1} paddingY={2}>
          No saved prompts in this project yet.
        </Text>
      )}
    </VStack>
  );
}
