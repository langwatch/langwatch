/**
 * The small pieces every Agent Testing dialog is drawn from: the label above a
 * field, the field styling itself, and the message under a field the server or
 * the schema refused.
 *
 * One copy, so the scenario dialog, the run plan dialog and the run dialog
 * all read the same.
 */

import { HStack, Text } from "@chakra-ui/react";
import { FG_MUTED } from "./design";

/** One label above a field. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <HStack
      as="span"
      gap={1.5}
      marginBottom={1}
      fontSize="11.5px"
      fontWeight="medium"
      color={FG_MUTED}
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
  fontSize: "13px",
  height: "auto",
  minHeight: "auto",
} as const;

/** What the form says about a field it refused. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <Text marginTop={1} fontSize="11px" color="red.fg">
      {message}
    </Text>
  );
}
