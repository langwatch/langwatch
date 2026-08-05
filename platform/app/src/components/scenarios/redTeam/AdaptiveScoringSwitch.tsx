import { Field, Switch } from "@chakra-ui/react";
import type { UseFormReturn } from "react-hook-form";

import type { ScenarioFormData } from "../ScenarioForm";
import { LabelWithHelp } from "./LabelWithHelp";

/**
 * Score every reply and let the attacker adapt.
 *
 * Both knobs move together: the docs' fast recipe disables scoring and refusal
 * detection as a pair, and refusal detection only feeds the scorer.
 */
export function AdaptiveScoringSwitch({
  form,
  scoringOn,
}: {
  form: UseFormReturn<ScenarioFormData>;
  scoringOn: boolean;
}) {
  const { setValue, getValues } = form;
  return (
    <Field.Root>
      <LabelWithHelp
        label="Adaptive scoring"
        help="Every reply is scored 0-10 and the attacker adjusts its next move, backing out of a line that got a hard refusal. Turning it off is the recommended way to make a run cheaper — it keeps the full turn budget, but the attacker stops reacting to what the agent said."
      />
      <Switch.Root
        checked={scoringOn}
        onCheckedChange={({ checked }) =>
          setValue("redTeamConfig", {
            ...(getValues("redTeamConfig") ?? {}),
            scoreResponses: checked,
            detectRefusals: checked,
          })
        }
        colorPalette="redteam"
      >
        <Switch.HiddenInput />
        <Switch.Control cursor="pointer">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
    </Field.Root>
  );
}
