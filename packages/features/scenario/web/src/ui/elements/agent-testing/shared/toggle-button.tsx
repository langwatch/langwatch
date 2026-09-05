/**
 * An on and off control of the Agent Testing surface.
 */

import { Button, type ButtonProps } from "@chakra-ui/react";

export type ToggleButtonProps = ButtonProps & {
  /** Whether what the button turns on is on. */
  isOn: boolean;
};

export function ToggleButton({ isOn, ...props }: ToggleButtonProps) {
  return (
    <Button
      size="xs"
      variant="outline"
      height="32px"
      paddingX="10px"
      fontSize="12.5px"
      fontWeight="medium"
      gap={1.5}
      aria-pressed={isOn}
      colorPalette={isOn ? "blue" : undefined}
      background={isOn ? "blue.subtle" : undefined}
      borderColor={isOn ? "blue.emphasized" : undefined}
      color={isOn ? "blue.fg" : undefined}
      {...props}
    />
  );
}
