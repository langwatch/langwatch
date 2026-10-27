/**
 * One labelled setting. Inline on a settings page: label and hint left, control right, a rule
 * between rows. Stacked (label above) inside a Drawer or Dialog. Spacing is its own: never
 * pad, border or re-inset it. Save sits in the section's `footer`.
 */
import { Box, Field, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { type FieldLayout, useFieldLayout } from "./field-layout.ts";

export interface SettingsFieldProps {
  label: ReactNode;
  /** One sentence on what the setting does for the reader. Longer reasoning: a docs link. */
  hint?: ReactNode;
  /** The message to show under the control; its presence marks the field invalid. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Overrides the context: a page reads `inline`, a drawer or dialog `stacked`. */
  layout?: FieldLayout;
  /** `end` right-aligns a short control (a switch, a toggle) in the inline layout. */
  controlAlign?: "start" | "end";
  children: ReactNode;
  "data-testid"?: string;
}

const LABEL = { textStyle: "sm", fontWeight: "medium", color: "fg", margin: 0 } as const;
const HINT = { textStyle: "sm", color: "fg.muted", margin: 0 } as const;
const ERROR = { textStyle: "sm", color: "fg.error", margin: 0 } as const;

export function SettingsField({
  label,
  hint,
  error,
  required,
  disabled,
  readOnly,
  layout,
  controlAlign = "start",
  children,
  "data-testid": testId,
}: SettingsFieldProps) {
  const contextLayout = useFieldLayout();
  const resolved = layout ?? contextLayout;
  const invalid = error != null && error !== false && error !== "";
  const caption = (
    <Field.Label {...LABEL}>
      {label}
      {required && <Field.RequiredIndicator />}
    </Field.Label>
  );
  const hintText = hint ? <Field.HelperText {...HINT}>{hint}</Field.HelperText> : null;
  const errorText = invalid ? <Field.ErrorText {...ERROR}>{error}</Field.ErrorText> : null;

  if (resolved === "stacked") {
    return (
      <Field.Root
        invalid={invalid}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        gap={1.5}
        data-testid={testId}
        data-layout="stacked"
      >
        <VStack align="stretch" gap={0.5}>
          {caption}
          {hintText}
        </VStack>
        <Box width="full">{children}</Box>
        {errorText}
      </Field.Root>
    );
  }

  return (
    <Field.Root
      invalid={invalid}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      paddingY={5}
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: 0 }}
      data-testid={testId}
      data-layout="inline"
    >
      <Grid
        width="full"
        templateColumns={{ base: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(0, 1fr)" }}
        columnGap={8}
        rowGap={1.5}
        alignItems="start"
      >
        <VStack align="stretch" gap={0.5} paddingTop={{ base: 0, md: 2 }} minWidth={0}>
          {caption}
          {hintText}
        </VStack>
        <VStack align="stretch" gap={1} minWidth={0}>
          <HStack width="full" justify={controlAlign === "end" ? "flex-end" : "flex-start"}>
            <Box width={controlAlign === "end" ? "auto" : "full"}>{children}</Box>
          </HStack>
          {errorText}
        </VStack>
      </Grid>
    </Field.Root>
  );
}

/** A run of fields in one section: the gap between them, nothing else. */
export function SettingsFieldGroup({ children }: { children: ReactNode }) {
  const layout = useFieldLayout();
  return (
    <VStack align="stretch" gap={layout === "stacked" ? 5 : 0} width="full">
      {children}
    </VStack>
  );
}

/** Text for a value the reader may see but not change, in a field's control slot. */
export function SettingsFieldValue({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="sm" color="fg" paddingY={{ base: 0, md: 2 }} wordBreak="break-word">
      {children}
    </Text>
  );
}
