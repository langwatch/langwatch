import { useState } from "react";

import { readThemeChoice, saveThemeChoice, type ThemeChoice } from "../theme.ts";
import type { ControlSize } from "./button.tsx";
import { IconMonitor, IconMoon, IconSun } from "./icons.tsx";
import { SegmentedControl, type SegmentOption } from "./segmented-control.tsx";

const options: SegmentOption<ThemeChoice>[] = [
  { value: "system", label: "System theme", icon: <IconMonitor /> },
  { value: "light", label: "Light theme", icon: <IconSun /> },
  { value: "dark", label: "Dark theme", icon: <IconMoon /> },
];

export type ThemeToggleProps = { size?: ControlSize };

export const ThemeToggle = ({ size = "sm" }: ThemeToggleProps) => {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  return (
    <SegmentedControl
      label="Theme"
      options={options}
      value={choice}
      size={size}
      iconOnly
      onChange={(next) => {
        saveThemeChoice({ choice: next });
        setChoice(next);
      }}
    />
  );
};
