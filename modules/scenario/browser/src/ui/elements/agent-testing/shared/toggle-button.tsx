/**
 * An on and off control of the Agent Testing surface.
 */

import { Button, type ButtonProps } from "@langwatch/design-system/primitives";

/** The one look every toolbar control shares: height, radius, type and padding. */
export const TOOLBAR_BUTTON_PROPS = {
  size: "xs",
  variant: "outline",
  height: "32px",
  paddingX: "10px",
  borderRadius: "lg",
  background: "bg.panel",
  fontSize: "12.5px",
  fontWeight: "medium",
  gap: 1.5,
} satisfies ButtonProps;

export type ToggleButtonProps = ButtonProps & {
  /** Whether what the button turns on is on. */
  isOn: boolean;
};

export function ToggleButton({ isOn, ...props }: ToggleButtonProps) {
  return (
    <Button
      {...TOOLBAR_BUTTON_PROPS}
      aria-pressed={isOn}
      colorPalette={isOn ? "blue" : undefined}
      background={isOn ? "blue.subtle" : TOOLBAR_BUTTON_PROPS.background}
      borderColor={isOn ? "blue.emphasized" : undefined}
      color={isOn ? "blue.fg" : undefined}
      {...props}
    />
  );
}
