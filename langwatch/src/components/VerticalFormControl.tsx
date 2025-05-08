import { Box, Field, VStack, type SystemStyleObject } from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";
import type { FieldErrors } from "react-hook-form";
import { HorizontalFormControl } from "./HorizontalFormControl";

export function VerticalFormControl({
  label,
  helper,
  invalid,
  children,
  inputWidth,
  error,
  size = "md",
  ...props
}: PropsWithChildren<{
  label: string | ReactNode;
  helper?: string | ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  error?: FieldErrors<any>[0] | ReactNode;
  size?: "sm" | "md";
}> &
  SystemStyleObject) {
  return (
    <HorizontalFormControl
      label={label}
      helper={helper}
      invalid={invalid}
      inputWidth={inputWidth}
      size={size}
      error={error}
      {...props}
      direction="vertical"
    >
      {children}
    </HorizontalFormControl>
  );
}
