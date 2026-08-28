import { Box, HStack, Text } from "@chakra-ui/react";
import { type ReactNode, useId } from "react";
import type { FieldError } from "react-hook-form";
import "../authFrontDoor.css";
import { MONO_FONT } from "../frontDoorTheme";

/**
 * One labelled row of the front door's forms: a small quiet label, the input,
 * and the words of a rejection under it.
 *
 * The board's field, not the app's settings form: no helper line repeating the
 * label in different words, no title casing, nothing between the label and the
 * field. The label's right-hand side is a slot, because "Forgot password?"
 * belongs on the label line and nowhere else.
 *
 * The label is a real `<label>` wired by id, so clicking it focuses the field
 * and a test (or a screen reader) finds the input by its name. The error is
 * plain text in the danger colour: a rejection on the field it belongs to is
 * already where the person is looking, and a red banner on top of a red line
 * would say it twice.
 */
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
        <Text
          fontSize="12.5px"
          lineHeight="1.5"
          marginTop="6px"
          color={"frontDoor.danger"}
        >
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
