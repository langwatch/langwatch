/**
 * The Simulation models tab of the run plan editor: the model that role-plays
 * the user, and the model that judges the runs.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, Grid, Text, VStack } from "@chakra-ui/react";
import { SimulationModelSelect } from "~/components/scenarios/SimulationModelSelect";
import { FG_MUTED } from "../shared/design";
import { FieldError, FieldLabel } from "../shared/DialogFields";
import type { PlanEditorState } from "./usePlanEditor";

export function PlanModelsTab({ editor }: { editor: PlanEditorState }) {
  const { suiteForm } = editor;
  const errors = suiteForm.form.formState.errors;

  return (
    <VStack align="stretch" gap={4}>
      <Text fontSize="12px" color={FG_MUTED}>
        Choose the models that role-play the user and judge the runs. Both
        default to your project&apos;s Default model.
      </Text>

      <Grid templateColumns="1fr 1fr" gap={3}>
        <Box>
          <FieldLabel>User simulator</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.user_simulator"
            value={suiteForm.simulatorModel}
            onChange={suiteForm.setSimulatorModel}
            size="sm"
          />
          <FieldError message={errors.simulatorModel?.message} />
        </Box>
        <Box>
          <FieldLabel>Judge</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.judge"
            value={suiteForm.judgeModel}
            onChange={suiteForm.setJudgeModel}
            size="sm"
          />
          <FieldError message={errors.judgeModel?.message} />
        </Box>
      </Grid>
    </VStack>
  );
}
