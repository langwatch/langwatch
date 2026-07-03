import { Switch as ChakraSwitch } from "@chakra-ui/react";
import * as React from "react";

/**
 * Chakra v3 Switch wrapper.
 *
 * N.B. `onChange` is deliberately NOT accepted here — Chakra v3's `Root`
 * exposes state via `onCheckedChange({ checked })`, not a DOM ChangeEvent.
 * A previous version of this file declared an `onChange` prop that only
 * spread into `...rest` and was silently discarded by `ChakraSwitch.Root`,
 * so callers who wrote `<Switch onChange={…}>` got a compile-clean but
 * runtime-dead toggle. Callers MUST use `onCheckedChange` — leaving
 * `onChange` off the type surface forces TypeScript to catch mis-wired
 * consumers instead of silently no-op'ing them.
 */
export interface SwitchProps extends ChakraSwitch.RootProps {
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  rootRef?: React.Ref<HTMLLabelElement>;
  trackLabel?: { on: React.ReactNode; off: React.ReactNode };
  thumbLabel?: { on: React.ReactNode; off: React.ReactNode };
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  function Switch(props, ref) {
    const { inputProps, children, rootRef, trackLabel, thumbLabel, ...rest } =
      props;

    return (
      <ChakraSwitch.Root
        ref={rootRef}
        {...rest}
        colorPalette={rest.colorPalette ?? "blue"}
      >
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
            <ChakraSwitch.Indicator fallback={trackLabel.off}>
              {trackLabel.on}
            </ChakraSwitch.Indicator>
          )}
        </ChakraSwitch.Control>
        {children != null && (
          <ChakraSwitch.Label>{children}</ChakraSwitch.Label>
        )}
      </ChakraSwitch.Root>
    );
  },
);
