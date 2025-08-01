import {
  Box,
  Field,
  HStack,
  Spacer,
  VStack,
  type SystemStyleObject,
} from "@chakra-ui/react";
import { type PropsWithChildren, type ReactNode } from "react";
import { Info } from "react-feather";
import type { FieldErrors } from "react-hook-form";

import { Tooltip } from "~/components/ui/tooltip";

export interface HorizontalFormControlProps extends SystemStyleObject {
  label: string | ReactNode;
  helper?: string | ReactNode;
  tooltip?: ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  direction?: "horizontal" | "vertical";
  size?: "sm" | "md";
  error?: FieldErrors<any>[0] | ReactNode;
  align?: "start" | "end";
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
        flexDirection={
          direction === "horizontal" ? ["column", "column", "row"] : "column"
        }
        align={align}
      >
        <VStack
          align="start"
          gap={size === "sm" ? 0 : 1}
          width="full"
          minWidth={minWidth}
        >
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
          >
            <HStack gap={2}>
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
        <Box minWidth={["full", "full", inputWidth ?? "50%"]}>{children}</Box>
        {error && (
          <Field.ErrorText margin={0} fontSize="13px">
            {typeof error == "object" && "message" in error
              ? error.message?.toString()
              : (error as any)}
          </Field.ErrorText>
        )}
      </HStack>
    </Field.Root>
  );
}
