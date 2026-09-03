/**
 * The prompts of the project, grouped under their handle test suites the way the
 * prompt list shows them.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, FileText, Folder } from "lucide-react";
import type { TargetValue } from "../../scenarios/target-selector";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";

/** One prompt as the picker lists it. */
export type PromptEntry = {
  id: string;
  handle: string | null;
  version: number;
};

type PromptSelect = (target: NonNullable<TargetValue>) => void;

/** The test suite a prompt files under: its handle prefix, "default" when none. */
export function groupPromptsByTestSuite(
  prompts: PromptEntry[],
): { testSuite: string; prompts: PromptEntry[] }[] {
  const groups = new Map<string, PromptEntry[]>();
  for (const prompt of prompts) {
    const handle = prompt.handle ?? prompt.id;
    const testSuite = handle.includes("/") ? (handle.split("/")[0] ?? "default") : "default";
    const held = groups.get(testSuite);
    if (held) held.push(prompt);
    else groups.set(testSuite, [prompt]);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === "default") return 1;
      if (b[0] === "default") return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([testSuite, held]) => ({ testSuite, prompts: held }));
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
      boxShadow={QUIET_BUTTON_SHADOW}
      borderWidth="1px"
      borderColor={isActive ? "blue.500" : "transparent"}
      background={isActive ? "blue.subtle" : undefined}
      _hover={{ background: isActive ? "blue.subtle" : "bg.muted/60" }}
      borderRadius="lg"
      paddingX={3}
      paddingY={2}
      gap={2.5}
      onClick={() => onSelect({ type: "prompt", id: prompt.id })}
      data-testid={`run-dialog-prompt-${prompt.id}`}
      aria-pressed={isActive}
    >
      <FileText size={15} color="var(--chakra-colors-green-500)" />
      <Box minWidth={0} flex={1}>
        <Text fontSize="12.5px" fontWeight="medium" truncate>
          {prompt.handle ?? prompt.id}
        </Text>
        <Text fontSize="11px" color={FG_MUTED} truncate>
          v{prompt.version}
        </Text>
      </Box>
      {isActive && <Check size={14} color="var(--chakra-colors-blue-500)" />}
    </HStack>
  );
}

/** One test suite of prompts, headed by its name unless it is the default one. */
function PromptTestSuiteGroup({
  testSuite,
  prompts,
  selected,
  onSelect,
}: {
  testSuite: string;
  prompts: PromptEntry[];
  selected: TargetValue;
  onSelect: PromptSelect;
}) {
  return (
    <VStack align="stretch" gap={1.5}>
      {testSuite !== "default" && (
        <HStack gap={1.5} paddingX={1} marginBottom={-0.5}>
          <Folder size={11} color="var(--chakra-colors-fg-muted)" />
          <Text fontSize="11px" fontWeight="semibold" color={FG_MUTED}>
            {testSuite}
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

/** The prompts under their test suites, the way the prompt list shows them. */
export function PromptPicker({
  prompts,
  selected,
  onSelect,
}: {
  prompts: PromptEntry[];
  selected: TargetValue;
  onSelect: PromptSelect;
}) {
  const groups = groupPromptsByTestSuite(prompts);

  return (
    <VStack
      align="stretch"
      gap={2}
      maxHeight="228px"
      overflowY="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      padding={2}
      data-testid="run-dialog-prompts"
    >
      {groups.map((group) => (
        <PromptTestSuiteGroup
          key={group.testSuite}
          testSuite={group.testSuite}
          prompts={group.prompts}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {prompts.length === 0 && (
        <Text fontSize="12px" color={FG_MUTED} paddingX={1} paddingY={2}>
          No saved prompts in this project yet.
        </Text>
      )}
    </VStack>
  );
}
