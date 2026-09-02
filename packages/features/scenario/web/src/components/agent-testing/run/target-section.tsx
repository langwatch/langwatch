/**
 * The target area of the run dialog: the agent cards, the prompt picker, or
 * the setup box a project with nothing to test reads instead.
 *
 * The label line carries Configure, which opens the agents page in another
 * tab so the dialog and whatever it was about to run are still here on the
 * way back.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { chakra, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import type { TargetValue } from "../../scenarios/target-selector";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { getRoutePath } from "@langwatch/workflow-web/utils/routes";
import { FieldLabel } from "../shared/dialog-fields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/remove-block-button";
import { type PromptEntry, PromptPicker } from "./prompt-picker";
import {
  AgentBlocks,
  type RunDialogAgent,
  SetupAgentBox,
} from "./run-target-picker";
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

/** The way to the page where the agents of the project are set up. */
function ConfigureAgentsLink() {
  const { project } = useOrganizationTeamProject();
  if (!project) return null;

  return (
    <chakra.a
      href={getRoutePath({ projectSlug: project.slug, route: "agents" })}
      target="_blank"
      rel="noopener noreferrer"
      marginLeft="auto"
      display="flex"
      alignItems="center"
      gap={1}
      fontSize="11.5px"
      fontWeight="medium"
      color={FG_MUTED}
      _hover={{ color: "fg" }}
      data-testid="run-dialog-configure-agents"
    >
      Configure
      <ExternalLink size={11} />
    </chakra.a>
  );
}

/** The agent cards, the prompt picker, or the setup box. */
export function TargetSection(props: TargetSectionProps) {
  const { mode, agents, prompts, target, onSelect } = props;

  return (
    <VStack align="stretch" gap={0}>
      <FieldLabel>
        {mode === "prompts" ? "Prompt to be tested" : "Agent to be tested"}
        {mode === "prompts" ? (
          <RemoveBlockButton
            label="Remove the prompt picker"
            onClick={props.onRemovePromptPicker}
          />
        ) : (
          <ConfigureAgentsLink />
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
