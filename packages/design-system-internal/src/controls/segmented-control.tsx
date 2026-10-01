import { useId, type ReactNode } from "react";

import { flag } from "../class-names.ts";
import type { ControlSize } from "./button.tsx";

export type SegmentOption<Value extends string> = {
  value: Value;
  label: string;
  icon?: ReactNode;
};

export type SegmentedControlProps<Value extends string> = {
  /** Names the group for screen readers. */
  label: string;
  options: SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  size?: ControlSize;
  /** Show only each option's icon; its label stays as the name and title. */
  iconOnly?: boolean;
};

/** Native radios under the paint, so arrow keys and forms behave as the platform does. */
export const SegmentedControl = <Value extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  iconOnly = false,
}: SegmentedControlProps<Value>) => {
  const name = useId();
  return (
    <div className="ds-segmented" role="radiogroup" aria-label={label} data-size={size}>
      {options.map((option) => (
        <label
          key={option.value}
          className="ds-segment"
          data-icon-only={flag({ on: iconOnly })}
          title={iconOnly ? option.label : undefined}
        >
          <input
            type="radio"
            className="ds-segment-input"
            name={name}
            value={option.value}
            checked={option.value === value}
            aria-label={iconOnly ? option.label : undefined}
            onChange={() => onChange(option.value)}
          />
          {option.icon}
          {iconOnly ? null : option.label}
        </label>
      ))}
    </div>
  );
};
