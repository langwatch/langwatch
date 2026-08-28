/**
 * The blocks the chips add beyond the note and the parameters: a second agent
 * to compare against, the simulation models, and the repeat count.
 *
 * Each block carries the control that takes it away again, and removing one
 * puts its value back to what the run would carry without it.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, Grid, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { SimulationModelSelect } from "~/components/scenarios/SimulationModelSelect";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { AgentBlocks, type RunDialogAgent } from "./RunTargetPicker";

/** The second agent the run goes against, beside the first. */
export function CompareTargetsSection({
  agents,
  primary,
  compareTarget,
  onSelect,
  onRemove,
}: {
  agents: RunDialogAgent[];
  primary: TargetValue;
  compareTarget: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
  onRemove: () => void;
}) {
  // The agent already being tested is not offered again: a run against the
  // same agent twice compares nothing.
  const others = agents.filter((agent) => agent.id !== primary?.id);

  return (
    <VStack align="stretch" gap={0} data-testid="run-dialog-compare">
      <FieldLabel>
        Compare against
        <RemoveBlockButton label="Remove the comparison" onClick={onRemove} />
      </FieldLabel>
      {others.length > 0 ? (
        <AgentBlocks
          agents={others}
          selected={compareTarget}
          onSelect={onSelect}
        />
      ) : (
        <Text fontSize="11.5px" color={FG_MUTED}>
          There is no second agent to compare against yet.
        </Text>
      )}
    </VStack>
  );
}

/** The model that plays the user, and the model that judges the runs. */
export function SimulationModelsSection({
  simulatorModel,
  judgeModel,
  onSimulatorChange,
  onJudgeChange,
  onRemove,
}: {
  simulatorModel: string | null;
  judgeModel: string | null;
  onSimulatorChange: (model: string | null) => void;
  onJudgeChange: (model: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <VStack align="stretch" gap={0} data-testid="run-dialog-models">
      <FieldLabel>
        Simulation models
        <RemoveBlockButton
          label="Remove the simulation models"
          onClick={onRemove}
        />
      </FieldLabel>
      <Grid templateColumns="1fr 1fr" gap={3}>
        <Box>
          <FieldLabel>User simulator</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.user_simulator"
            value={simulatorModel}
            onChange={onSimulatorChange}
            size="sm"
          />
        </Box>
        <Box>
          <FieldLabel>Judge</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.judge"
            value={judgeModel}
            onChange={onJudgeChange}
            size="sm"
          />
        </Box>
      </Grid>
    </VStack>
  );
}

/** How many times each scenario and target pair runs. */
export function RepeatCountSection({
  repeatCount,
  onChange,
  onRemove,
}: {
  repeatCount: number;
  onChange: (count: number) => void;
  onRemove: () => void;
}) {
  return (
    <VStack align="stretch" gap={0} data-testid="run-dialog-repeat">
      <FieldLabel>
        Run multiple times
        <RemoveBlockButton label="Remove the repeat count" onClick={onRemove} />
      </FieldLabel>
      <HStack
        gap={2}
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        paddingX={3}
        paddingY={2.5}
        fontSize="12.5px"
      >
        <Input
          {...DIALOG_FIELD_STYLE}
          type="number"
          width="56px"
          paddingX={2}
          fontSize="12px"
          aria-label="Repeat count"
          min={1}
          max={MAX_REPEAT_COUNT}
          value={repeatCount}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <Text color={FG_MUTED}>
          times per scenario and target (max {MAX_REPEAT_COUNT})
        </Text>
      </HStack>
    </VStack>
  );
}
