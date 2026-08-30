/**
 * The target area of the run dialog: the agent cards, the prompt picker, or
 * the setup box a project with nothing to test reads instead.
 *
 * The label line carries Configure, which opens the agents page in another
 * tab so the dialog and whatever it was about to run are still here on the
 * way back. It also carries the switch that reveals other people's
 * development agents, when the project holds any.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import {
  hasTeammateAgents,
  offeredAgents,
  TEAMMATES_TOGGLE_LABEL,
} from "~/components/scenarios/useFilteredScenarioTargets";
import { Switch } from "~/components/ui/switch";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getRoutePath } from "~/utils/routes";
import { FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
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
    </chakra.a>
  );
}

/**
 * The switch that reveals other people's development agents.
 *
 * Off by default: a team where each developer runs the same agent on their
 * own machine would otherwise fill the picker with cards the person in front
 * of it cannot run.
 */
function TeammatesToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <HStack gap={2} marginLeft="auto">
      <Text fontSize="11.5px" fontWeight="medium" color={FG_MUTED}>
        {TEAMMATES_TOGGLE_LABEL}
      </Text>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={(event) => onChange(event.checked)}
        data-testid="run-dialog-show-teammates"
      />
    </HStack>
  );
}

/** The agent cards, the prompt picker, or the setup box. */
export function TargetSection(props: TargetSectionProps) {
  const { mode, agents, prompts, target, onSelect } = props;
  const [showTeammates, setShowTeammates] = useState(false);
  const offered = offeredAgents({ agents, showTeammates });

  return (
    <VStack align="stretch" gap={0} data-testid="run-dialog-target-section">
      <FieldLabel>
        {mode === "prompts" ? "Prompt to be tested" : "Agent to be tested"}
        {mode === "prompts" ? (
          <RemoveBlockButton
            label="Remove the prompt picker"
            onClick={props.onRemovePromptPicker}
          />
        ) : (
          <>
            {hasTeammateAgents(agents) && (
              <TeammatesToggle
                checked={showTeammates}
                onChange={setShowTeammates}
              />
            )}
            <ConfigureAgentsLink />
          </>
        )}
      </FieldLabel>
      {mode === "prompts" ? (
        <PromptPicker prompts={prompts} selected={target} onSelect={onSelect} />
      ) : offered.length > 0 ? (
        <AgentBlocks agents={offered} selected={target} onSelect={onSelect} />
      ) : (
        <SetupAgentBox onSetup={props.onSetupAgent} />
      )}
    </VStack>
  );
}
