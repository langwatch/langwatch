import {
  Checkbox as ChakraCheckbox,
  CheckboxGroup as ChakraCheckboxGroup,
  type CheckboxGroupProps,
} from "@chakra-ui/react";
import * as React from "react";

export interface CheckboxProps extends ChakraCheckbox.RootProps {
  icon?: React.ReactNode;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  rootRef?: React.Ref<HTMLLabelElement>;
}

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<CheckboxProps, "onChange"> & {
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  }
>(function Checkbox(props, ref) {
  const { icon, children, inputProps, rootRef, ...rest } = props;
  return (
    <ChakraCheckbox.Root ref={rootRef} {...(rest as any as CheckboxProps)}>
      <ChakraCheckbox.HiddenInput ref={ref} {...inputProps} />
      <ChakraCheckbox.Control
        borderColor={!rest.checked ? rest.borderColor : undefined}
      >
        {icon ?? <ChakraCheckbox.Indicator />}
      </ChakraCheckbox.Control>
      {children != null && (
        <ChakraCheckbox.Label>{children}</ChakraCheckbox.Label>
      )}
    </ChakraCheckbox.Root>
  );
});

export const CheckboxGroup = React.forwardRef<
  HTMLDivElement,
  Omit<CheckboxGroupProps, "onChange"> & {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }
>((props, ref) => {
  const { children, ...rest } = props;
  return (
    <ChakraCheckboxGroup ref={ref} {...(rest as any)}>
      {children}
    </ChakraCheckboxGroup>
  );
});
