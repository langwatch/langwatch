import { useId } from "react";

import { IconChevronDown } from "../icons.tsx";
import type { ControlSize } from "./button.tsx";
import { describedBy, Field, type FieldText } from "./field.tsx";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = FieldText & {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  size?: ControlSize;
  disabled?: boolean;
  name?: string;
  id?: string;
};

export const Select = ({
  label,
  hideLabel,
  hint,
  error,
  options,
  value,
  onChange,
  size = "md",
  disabled = false,
  name,
  id,
}: SelectProps) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <Field id={selectId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <div className="ds-select-wrap">
        <select
          id={selectId}
          name={name}
          className="ds-select"
          data-size={size}
          value={value}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy({ id: selectId, hint, error })}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="ds-select-chevron">
          <IconChevronDown />
        </span>
      </div>
    </Field>
  );
};
