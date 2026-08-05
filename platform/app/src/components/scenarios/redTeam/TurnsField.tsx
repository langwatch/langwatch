import { Field, Input } from "@chakra-ui/react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";

import {
  RED_TEAM_DEFAULT_TURNS,
  RED_TEAM_MAX_TURNS,
} from "~/server/scenarios/execution/types";
import type { ScenarioFormData } from "../ScenarioForm";
import { LabelWithHelp } from "./LabelWithHelp";

/** Turn budget for the attack. */
export function TurnsField({
  register,
  errors,
}: {
  register: UseFormRegister<ScenarioFormData>;
  errors: FieldErrors<ScenarioFormData>;
}) {
  return (
    <Field.Root invalid={!!errors.redTeamTotalTurns}>
      <LabelWithHelp
        label="Turns"
        help={`How many attempts the attacker gets. Agents that hold at turn 1 often break by turn 20, so ${RED_TEAM_DEFAULT_TURNS} is the recommended starting point and the maximum. To make a run cheaper, turn off adaptive scoring under Advanced rather than cutting turns.`}
      />
      <Input
        type="number"
        min={1}
        max={RED_TEAM_MAX_TURNS}
        width="120px"
        {...register("redTeamTotalTurns", {
          setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
        })}
      />
      {/* `min`/`max` on a number input are advisory — they colour the
          spinner and nothing else. Typing 51 is allowed, the schema rejects
          it, and without this the only symptom is a Save button that stops
          working. */}
      <Field.ErrorText>
        {errors.redTeamTotalTurns?.message ??
          `Enter a whole number between 1 and ${RED_TEAM_MAX_TURNS}.`}
      </Field.ErrorText>
    </Field.Root>
  );
}
