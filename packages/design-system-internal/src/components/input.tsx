import { useId, type ComponentPropsWithoutRef } from "react";

import type { ControlSize } from "./button.tsx";
import { flag } from "./class-names.ts";
import { describedBy, Field, type FieldText } from "./field.tsx";

export type InputProps = FieldText &
  Omit<ComponentPropsWithoutRef<"input">, "size" | "onChange" | "className" | "style"> & {
    size?: ControlSize;
    mono?: boolean;
    onChange?: (value: string) => void;
  };

export const Input = ({
  label,
  hideLabel,
  hint,
  error,
  size = "md",
  mono = false,
  onChange,
  id,
  ...native
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <Field id={inputId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <input
        {...native}
        id={inputId}
        className="ds-input"
        data-size={size}
        data-mono={flag({ on: mono })}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy({ id: inputId, hint, error })}
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
      />
    </Field>
  );
};
