/// <reference path="../../model/ambient.d.ts" />
import { Box, HStack, Text } from "@chakra-ui/react";
import { type ReactNode, useId } from "react";
import type { FieldError } from "react-hook-form";
import "./auth-front-door.css";
import { MONO_FONT } from "../../model/front-door-theme.ts";

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
        {/* The site's small technical voice: mono, spaced, quiet — the same
            register the "or" divider speaks in. */}
        <Text
          asChild
          fontFamily={MONO_FONT}
          fontSize="11px"
          textTransform="uppercase"
          letterSpacing="0.14em"
          color="fg.muted"
        >
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

/** The focus treatment every front-door input shares: the brand's ring. */
export const FIELD_FOCUS = {
  borderColor: "frontDoor.detail",
  boxShadow: "0 0 0 3px {colors.frontDoor.focusRing}",
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
