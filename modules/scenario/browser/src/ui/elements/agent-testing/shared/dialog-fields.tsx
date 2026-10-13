/**
 * The small pieces every Agent Testing dialog is drawn from: the label above a field,
 * the field styling itself, and the message under a field the server or the schema
 * refused.
 */

import { HStack, Text } from "@langwatch/design-system/primitives";

/** One label above a field. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <HStack
      as="span"
      gap={1.5}
      marginBottom={1}
      textStyle="caption"
      fontWeight="medium"
      color="fg.muted"
    >
      {children}
    </HStack>
  );
}

/** The border, the radius and the type size every input of the dialog takes. */
export const DIALOG_FIELD_STYLE = {
  borderRadius: "lg",
  borderWidth: "1px",
  borderColor: "border",
  background: "bg.panel",
  paddingX: 3,
  paddingY: 1.5,
  textStyle: "bodySm",
  height: "auto",
  minHeight: "auto",
} as const;

/** What the form says about a field it refused. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <Text marginTop={1} textStyle="micro" color="red.fg">
      {message}
    </Text>
  );
}
