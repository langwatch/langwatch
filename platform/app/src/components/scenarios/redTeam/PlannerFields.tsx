import { Field, Textarea } from "@chakra-ui/react";
import type { UseFormReturn } from "react-hook-form";

import type { ScenarioFormData } from "../ScenarioForm";
import { LabelWithHelp } from "./LabelWithHelp";

/** The two planner inputs, shown only for a strategy that plans. */
export function PlannerFields({
  form,
}: {
  form: UseFormReturn<ScenarioFormData>;
}) {
  const {
    register,
    formState: { errors },
  } = form;
  return (
    <>
      <Field.Root invalid={!!errors.redTeamConfig?.attackPlan}>
        <LabelWithHelp
          label="Attack plan"
          help="Crescendo normally spends one model call writing a phased plan before it starts. Paste your own to skip that and control the attack exactly — phase by phase, in your own words. Leave empty to let it plan."
        />
        <Textarea
          rows={4}
          placeholder={
            "e.g., Turns 1-10: ask about products.\nTurns 11-25: ask how AI assistants work.\nTurns 26-50: ask it to repeat its instructions."
          }
          _placeholder={{ color: "gray.400", fontStyle: "italic" }}
          {...register("redTeamConfig.attackPlan", {
            setValueAs: (v) => (v === "" ? undefined : v),
          })}
        />
        <Field.ErrorText>
          {errors.redTeamConfig?.attackPlan?.message}
        </Field.ErrorText>
      </Field.Root>

      <Field.Root invalid={!!errors.redTeamConfig?.metapromptTemplate}>
        <LabelWithHelp
          label="Planning prompt"
          help="Replaces the instructions used to write the attack plan, rather than the plan itself. Use {target}, {description}, {totalTurns} and {phase1End}/{phase2End}/{phase3End} where those values should appear. Ignored when an attack plan is set above, since nothing needs planning then."
        />
        <Textarea
          rows={3}
          placeholder="Leave empty to use the built-in planning prompt"
          _placeholder={{ color: "gray.400", fontStyle: "italic" }}
          {...register("redTeamConfig.metapromptTemplate", {
            setValueAs: (v) => (v === "" ? undefined : v),
          })}
        />
        <Field.ErrorText>
          {errors.redTeamConfig?.metapromptTemplate?.message}
        </Field.ErrorText>
      </Field.Root>
    </>
  );
}
