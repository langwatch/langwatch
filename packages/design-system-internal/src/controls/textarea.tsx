import { useId, type ComponentPropsWithoutRef } from "react";

import { flag } from "../class-names.ts";
import { describedBy, Field, type FieldText } from "./field.tsx";

export type TextareaProps = FieldText &
  Omit<ComponentPropsWithoutRef<"textarea">, "onChange" | "className" | "style"> & {
    mono?: boolean;
    onChange?: (value: string) => void;
  };

export const Textarea = ({
  label,
  hideLabel,
  hint,
  error,
  mono = false,
  onChange,
  id,
  rows = 4,
  ...native
}: TextareaProps) => {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  return (
    <Field id={textareaId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <textarea
        {...native}
        id={textareaId}
        rows={rows}
        className="ds-textarea"
        data-mono={flag({ on: mono })}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy({ id: textareaId, hint, error })}
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
      />
    </Field>
  );
};
