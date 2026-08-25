/**
 * The target area of the run dialog: the agent cards, the prompt picker, or
 * the setup box a project with nothing to test reads instead.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { VStack } from "@chakra-ui/react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { FieldLabel } from "../shared/DialogFields";
import { type PromptEntry, PromptPicker } from "./PromptPicker";
import { RemoveBlockButton } from "./RemoveBlockButton";
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

/** The agent cards, the prompt picker, or the setup box. */
export function TargetSection(props: TargetSectionProps) {
  const { mode, agents, prompts, target, onSelect } = props;

  return (
    <VStack align="stretch" gap={0}>
      <FieldLabel>
        {mode === "prompts" ? "Prompt to be tested" : "Agent to be tested"}
        {mode === "prompts" && (
          <RemoveBlockButton
            label="Remove the prompt picker"
            onClick={props.onRemovePromptPicker}
          />
        )}
      </FieldLabel>
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
