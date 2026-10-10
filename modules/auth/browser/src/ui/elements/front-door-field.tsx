import "../../model/ambient.d.ts";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { type ReactNode, useId } from "react";
import type { FieldError } from "react-hook-form";

import "./auth-front-door.css";

/** Form field row: label with optional end slot, input, and error below. */
export function FrontDoorField({
  label,
  labelEnd,
  error,
  children,
}: {
  label: string;
  /** The label line's far end: a quiet link, nothing louder. */
  labelEnd?: ReactNode;
  error?: FieldError;
  children: (id: string) => ReactNode;
}) {
  const id = useId();

  return (
    <Box width="full">
      <HStack width="full" justify="space-between" marginBottom="7px">
        <Text asChild fontSize="13px" fontWeight={500} color="fg">
          <label htmlFor={id}>{label}</label>
        </Text>
        {labelEnd ?? null}
      </HStack>
      {children(id)}
      {error?.message ? (
        <Text fontSize="12.5px" lineHeight="1.5" marginTop="6px" color={"frontDoor.danger"}>
          {error.message}
        </Text>
      ) : null}
    </Box>
  );
}

/** The focus treatment every front-door input shares: the product's own ring. */
export const FIELD_FOCUS = {
  borderColor: "frontDoor.focusRing",
  boxShadow: "0 0 0 1px {colors.frontDoor.focusRing}",
  outline: "none",
} as const;

/**
 * The surface every front-door input shares. The card is glass, so a field
 * sits one step more solid than the card it is on — enough for the type to
 * stay crisp with the ground moving underneath.
 */
export const FIELD_SURFACE = {
  backgroundColor: "frontDoor.fieldBg",
  borderColor: "frontDoor.fieldBorder",
} as const;
