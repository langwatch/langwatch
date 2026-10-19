import { useId, type ReactNode } from "react";

export type CheckboxProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
  name?: string;
};

export const Checkbox = ({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  name,
}: CheckboxProps) => {
  const id = useId();
  return (
    <label className="ds-checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="ds-checkbox-input"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="ds-checkbox-text">
        {label}
        {description !== undefined && (
          <span className="ds-checkbox-description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
};
