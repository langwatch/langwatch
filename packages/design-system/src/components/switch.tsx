import { Switch as ChakraSwitch } from "@chakra-ui/react";
import * as React from "react";

/** Chakra v3 Switch: use onCheckedChange, not onChange. Omitted from type to catch errors. */
export interface SwitchProps extends Omit<ChakraSwitch.RootProps, "onChange"> {
  /** The hidden input carries checked state and is the element tests address. */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & {
    [key: `data-${string}`]: string | undefined;
  };
  rootRef?: React.Ref<HTMLLabelElement>;
  trackLabel?: { on: React.ReactNode; off: React.ReactNode };
  thumbLabel?: { on: React.ReactNode; off: React.ReactNode };
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(function Switch(props, ref) {
  const { inputProps, children, rootRef, trackLabel, thumbLabel, ...rest } = props;

  return (
    <ChakraSwitch.Root ref={rootRef} {...rest} colorPalette={rest.colorPalette ?? "blue"}>
      <ChakraSwitch.HiddenInput ref={ref} {...inputProps} />
      <ChakraSwitch.Control>
        <ChakraSwitch.Thumb>
          {thumbLabel && (
            <ChakraSwitch.ThumbIndicator fallback={thumbLabel?.off}>
              {thumbLabel?.on}
            </ChakraSwitch.ThumbIndicator>
          )}
        </ChakraSwitch.Thumb>
        {trackLabel && (
          <ChakraSwitch.Indicator fallback={trackLabel.off}>{trackLabel.on}</ChakraSwitch.Indicator>
        )}
      </ChakraSwitch.Control>
      {children != null && <ChakraSwitch.Label>{children}</ChakraSwitch.Label>}
    </ChakraSwitch.Root>
  );
});
