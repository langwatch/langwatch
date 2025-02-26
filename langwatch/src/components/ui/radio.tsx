import { RadioGroup as ChakraRadioGroup } from "@chakra-ui/internal";
import * as React from "react";

export interface RadioProps extends ChakraRadioGroup.ItemProps {
  rootRef?: React.Ref<HTMLDivElement>;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

export const Radio = React.forwardRef<
  HTMLInputElement,
  Omit<RadioProps, "onChange"> & {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }
>(function Radio(props, ref) {
  const { children, inputProps, rootRef, ...rest } = props;
  return (
    <ChakraRadioGroup.Item ref={rootRef} {...rest}>
      <ChakraRadioGroup.ItemHiddenInput ref={ref} {...inputProps} />
      <ChakraRadioGroup.ItemIndicator cursor="pointer" />
      {children && (
        <ChakraRadioGroup.ItemText>{children}</ChakraRadioGroup.ItemText>
      )}
    </ChakraRadioGroup.Item>
  );
});

export const RadioGroup = React.forwardRef<
  HTMLDivElement,
  Omit<ChakraRadioGroup.RootProps, "onChange"> & {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }
>(function RadioGroup(props, ref) {
  const { children, ...rest } = props;
  return (
    <ChakraRadioGroup.Root
      ref={ref}
      {...rest}
      colorPalette={rest.colorPalette ?? "blue"}
    >
      {children}
    </ChakraRadioGroup.Root>
  );
});
