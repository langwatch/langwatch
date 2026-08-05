import { Field, Input } from "@chakra-ui/react";
import type { UseFormReturn } from "react-hook-form";

import type { ScenarioFormData } from "../ScenarioForm";
import { LabelWithHelp } from "./LabelWithHelp";

/**
 * A bounded numeric knob.
 *
 * Registered, not `defaultValue` + `setValue`. The old pair read the value once
 * on mount, so anything that changed the config afterwards — a `reset()`, or
 * switching strategy — left the input showing a value the form no longer held.
 *
 * An empty box means "use the SDK default", so it has to reach the schema as
 * `undefined` rather than as the number zero.
 */
export function NumberSetting({
  form,
  name,
  label,
  help,
  min,
  max,
  step,
  placeholder,
  fallbackError,
}: {
  form: UseFormReturn<ScenarioFormData>;
  name: "redTeamConfig.successScore" | "redTeamConfig.injectionProbability";
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
  placeholder: string;
  fallbackError: string;
}) {
  const {
    register,
    formState: { errors },
  } = form;
  const key = name.split(".")[1] as "successScore" | "injectionProbability";
  return (
    <Field.Root invalid={!!errors.redTeamConfig?.[key]}>
      <LabelWithHelp label={label} help={help} />
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        width="120px"
        placeholder={placeholder}
        {...register(name, {
          setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
        })}
      />
      <Field.ErrorText>
        {errors.redTeamConfig?.[key]?.message ?? fallbackError}
      </Field.ErrorText>
    </Field.Root>
  );
}
