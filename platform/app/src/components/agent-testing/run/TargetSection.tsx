/**
 * The target area of the run dialog: the agent blocks, the prompt picker, or
 * the setup box a project with nothing to test reads instead.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { type PromptEntry, PromptPicker } from "./PromptPicker";
import {
  AgentBlocks,
  type RunDialogAgent,
  SetupAgentBox,
} from "./RunTargetPicker";
import type { RunDialogMode } from "./run-dialog-types";

type TargetSectionProps = {
  mode: RunDialogMode;
  agents: RunDialogAgent[];
  prompts: PromptEntry[];
  target: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
  onRemovePromptPicker: () => void;
  onSetupAgent: () => void;
};

/** The agent blocks, the prompt picker, or the setup box. */
export function TargetSection(props: TargetSectionProps) {
  const { mode, agents, prompts, target, onSelect } = props;

  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          {mode === "prompts" ? "Prompt to be tested" : "Agent to be tested"}
        </Text>
        {mode === "prompts" && (
          <Button
            size="2xs"
            variant="ghost"
            color="fg.muted"
            aria-label="Remove the prompt picker"
            onClick={props.onRemovePromptPicker}
          >
            <X size={12} />
          </Button>
        )}
      </HStack>
      {mode === "prompts" ? (
        <PromptPicker prompts={prompts} selected={target} onSelect={onSelect} />
      ) : agents.length > 0 ? (
        <AgentBlocks agents={agents} selected={target} onSelect={onSelect} />
      ) : (
        <SetupAgentBox onSetup={props.onSetupAgent} />
      )}
    </VStack>
  );
}
