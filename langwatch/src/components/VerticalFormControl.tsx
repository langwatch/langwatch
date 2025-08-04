import { type PropsWithChildren, type ReactNode } from "react";
import type { FieldErrors } from "react-hook-form";

import {
  HorizontalFormControl,
  type HorizontalFormControlProps,
} from "./HorizontalFormControl";

export interface VerticalFormControlProps extends HorizontalFormControlProps {
  helper?: string | ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  error?: FieldErrors<any>[0] | ReactNode;
  size?: "sm" | "md";
}

export function VerticalFormControl({
  label,
  helper,
  invalid,
  children,
  inputWidth,
  error,
  size = "md",
  ...props
}: PropsWithChildren<VerticalFormControlProps>) {
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
