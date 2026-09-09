/**
 * A labelled field, stacked, with its errors under the input.
 *
 * A NARROWED family-local copy of `platform/app/src/components/VerticalFormControl.tsx`,
 * which is a thin wrapper over `HorizontalFormControl` — a two-direction
 * component with 40-odd callers this move may not repoint. Only the vertical
 * branch travels, and it is inlined rather than kept behind a `direction` prop
 * nothing here passes. `FormErrorDisplay`'s message walk travels with it,
 * because putting an error under the input it belongs to is the behaviour and
 * not the decoration.
 */

import { Box, Field, HStack, type SystemStyleObject, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";
import { isValidElement, type PropsWithChildren, type ReactNode } from "react";

export interface VerticalFormControlProps extends SystemStyleObject {
  label: string | ReactNode;
  helper?: string | ReactNode;
  tooltip?: ReactNode;
  invalid?: boolean;
  inputWidth?: string;
  size?: "sm" | "md";
  error?: unknown;
  align?: "start" | "end";
  labelProps?: SystemStyleObject;
}

/** Every `message` string reachable inside a react-hook-form error tree. */
export function extractErrorMessages(error: unknown): string[] {
  const messages: string[] = [];

  function processError(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("message" in value && typeof (value as { message?: unknown }).message === "string") {
      messages.push((value as { message: string }).message);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) processError(item);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) processError(item);
  }

  processError(error);
  return messages;
}

function FormErrorDisplay({ error }: { error?: unknown }) {
  if (isValidElement(error)) return <>{error}</>;
  if (error === null || error === undefined) return null;

  if (typeof error === "string" || typeof error === "number") {
    return (
      <Text marginTop="6px" fontSize="13px" color="fg.error">
        {error}
      </Text>
    );
  }

  const messages = extractErrorMessages(error);
  if (messages.length === 0) return null;

  return (
    <VStack align="start" gap={1} marginTop="6px">
      {messages.map((message, index) => (
        <Text key={index} fontSize="13px" color="fg.error">
          {message}
        </Text>
      ))}
    </VStack>
  );
}

export function VerticalFormControl({
  label,
  helper,
  tooltip,
  invalid,
  children,
  minWidth,
  align,
  size = "md",
  error,
  labelProps,
  ...props
}: PropsWithChildren<VerticalFormControlProps>) {
  return (
    <Field.Root
      borderBottomWidth="1px"
      paddingY={5}
      invalid={invalid}
      _last={{ border: "none" }}
      {...(size === "sm" && { paddingY: 0, border: "none" })}
      {...props}
    >
      <HStack width="full" flexDirection="column" align={align} gap={2}>
        <VStack align="start" gap={size === "sm" ? 0 : 1} width="full" minWidth={minWidth}>
          <Field.Label
            margin={0}
            paddingLeft={2}
            width="full"
            {...(size === "sm" && {
              fontSize: "12px",
              textTransform: "uppercase",
              color: "gray.500",
              fontWeight: "bold",
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
        <Box minWidth="full">
          {children}
          <FormErrorDisplay error={error} />
        </Box>
      </HStack>
    </Field.Root>
  );
}
