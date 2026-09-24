/**
 * A FAMILY-LOCAL COPY of `platform/app/src/components/HorizontalFormControl.tsx`,
 * also carried by `@langwatch/auth-browser`/`@langwatch/evaluator-browser`. Its one
 * `react-feather` glyph became `lucide-react`, the icon set moved packages use.
 */

import { Box, Field, HStack, Spacer, type SystemStyleObject, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import type { FieldErrors } from "react-hook-form";

import { FormErrorDisplay } from "./form-error-display.tsx";

export interface HorizontalFormControlProps extends SystemStyleObject {
  label: string | ReactNode;
  helper?: string | ReactNode;
  tooltip?: ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  direction?: "horizontal" | "vertical";
  size?: "sm" | "md";
  error?: FieldErrors[string] | ReactNode;
  align?: "start" | "end";
  labelProps?: SystemStyleObject;
}

export function HorizontalFormControl({
  label,
  helper,
  tooltip,
  invalid,
  children,
  minWidth,
  inputWidth,
  align,
  direction = "horizontal",
  size = "md",
  error,
  labelProps,
  ...props
}: PropsWithChildren<HorizontalFormControlProps>) {
  return (
    <Field.Root
      borderBottomWidth="1px"
      paddingY={5}
      invalid={invalid}
      _last={{ border: "none" }}
      {...(size === "sm" && {
        paddingY: 0,
        border: "none",
      })}
      {...props}
    >
      <HStack
        width="full"
        flexDirection={direction === "horizontal" ? ["column", "column", "row"] : "column"}
        align={align}
        gap={direction === "horizontal" ? 4 : 2}
      >
        <VStack align="start" gap={size === "sm" ? 0 : 1} width="full" minWidth={minWidth}>
          <Field.Label
            margin={0}
            {...(size === "sm" && {
              fontSize: "12px",
              textTransform: "uppercase",
              color: "gray.500",
              fontWeight: "bold",
            })}
            {...(direction === "vertical" && {
              paddingLeft: 2,
              width: "full",
            })}
            {...labelProps}
          >
            <HStack gap={2} width="full">
              {label}
              {tooltip && (
                <Tooltip content={tooltip} positioning={{ placement: "top" }}>
                  <Info size={14} />
                </Tooltip>
              )}
            </HStack>
          </Field.Label>
          <Field.HelperText margin={0} fontSize="13px">
            {helper}
          </Field.HelperText>
        </VStack>
        {direction === "horizontal" && <Spacer />}
        <Box minWidth={direction === "vertical" ? "full" : ["full", "full", inputWidth ?? "50%"]}>
          {children}
          {/*
            Under the field it belongs to, not beside it — as a sibling it took a
            third column's leftover width, so "Passwords don't match" arrived as
            three stacked words in a gutter. Inside the Box it takes the input's own width.
          */}
          <FormErrorDisplay error={error} />
        </Box>
      </HStack>
    </Field.Root>
  );
}
