import { Box, HStack, VStack } from "@chakra-ui/react";
import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";

import type { RedTeamStrategyName } from "~/server/scenarios/execution/types";
import { AdvancedSettings } from "./redTeam/AdvancedSettings";
import { ObjectiveField } from "./redTeam/ObjectiveField";
import { ATTACK_HELP } from "./redTeam/strategies";
import { StrategyPicker } from "./redTeam/StrategyPicker";
import { TurnsField } from "./redTeam/TurnsField";
import type { ScenarioFormData } from "./ScenarioForm";
import { SectionHeader } from "./ui/SectionHeader";
import { Tooltip } from "../ui/tooltip";

/**
 * The attack configuration, inline in the scenario editor.
 *
 * Deliberately not a second drawer: the objective you are writing and the
 * criteria it will be judged against belong on screen together, and a panel
 * over the editor hides exactly the thing you are writing against.
 *
 * Each control is its own module under `redTeam/`, so the composition here
 * reads as the order of the section on screen.
 *
 * See specs/scenarios/red-team-scenarios.feature.
 */
export function RedTeamAttackSection({
  form,
}: {
  form: UseFormReturn<ScenarioFormData>;
}) {
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = form;
  // GOAT reasons turn by turn and never pre-generates a plan
  // (needsMetapromptPlan = false), so the SDK ignores both planner fields for
  // it — one with a console warning, one silently. Showing inputs that do
  // nothing would be worse than not offering them.
  const strategy = useWatch({ control, name: "redTeamStrategy" });
  const planningApplies = strategy === "crescendo";
  const config = useWatch({ control, name: "redTeamConfig" });
  const scoringOn = config?.scoreResponses !== false;

  // The mismatch between a strategy and the planner fields is reported at
  // `redTeamConfig`, and both planner inputs live inside Advanced — so if it
  // fired while Advanced was shut, the form would refuse to save and show
  // nothing. Controlled, and opened by the error that explains itself.
  const [advancedOpen, setAdvancedOpen] = useState<string[]>([]);
  const configError = errors.redTeamConfig;
  const hasConfigError = !!configError;
  useEffect(() => {
    if (hasConfigError) setAdvancedOpen(["advanced"]);
  }, [hasConfigError]);

  /**
   * Switching strategy keeps the planner settings, and revalidates.
   *
   * The draft holds them so switching to GOAT to read what it does — and back
   * — does not destroy an attack plan someone wrote. What must not happen is
   * *storing* them on a GOAT scenario, and that is handled where the draft
   * becomes a write (`withApplicableRedTeamConfig`), not here.
   *
   * `shouldValidate` matters: the cross-field rule is evaluated against the
   * stripped value, so the stale error from the previous strategy has to be
   * recomputed on the switch rather than left sitting on the form.
   */
  const selectStrategy = (
    value: RedTeamStrategyName,
    onChange: (value: RedTeamStrategyName) => void,
  ) => {
    onChange(value);
    void form.trigger();
  };

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={1.5} align="center">
        <SectionHeader>Attack</SectionHeader>
        <Tooltip content={ATTACK_HELP}>
          <Box
            color="fg.muted"
            display="flex"
            cursor="pointer"
            paddingBottom="2px"
          >
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
      </HStack>

      <StrategyPicker
        control={control}
        hasConfigError={hasConfigError}
        configError={configError}
        selectStrategy={selectStrategy}
      />

      <ObjectiveField register={register} setValue={setValue} errors={errors} />

      <TurnsField register={register} errors={errors} />

      <AdvancedSettings
        form={form}
        advancedOpen={advancedOpen}
        setAdvancedOpen={setAdvancedOpen}
        planningApplies={planningApplies}
        scoringOn={scoringOn}
      />
    </VStack>
  );
}
