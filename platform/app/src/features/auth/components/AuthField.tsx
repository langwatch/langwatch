import { Box, HStack, Text, VisuallyHidden } from "@chakra-ui/react";
import { type ReactNode, useId } from "react";
import type { FieldError } from "react-hook-form";
import "../auth.css";
import { MONO_FONT } from "../authTheme";

/**
 * One labelled row of the auth screens' forms: a small quiet label, the input,
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
export function AuthField({
  label,
  labelEnd,
  labelHidden = false,
  error,
  children,
}: {
  label: string;
  /** The label line's far end: a quiet link, nothing louder. */
  labelEnd?: ReactNode;
  /**
   * The label stays the field's accessible name and stops being a line on
   * screen. For the one-field step whose placeholder already says the whole
   * thing — an email box reading you@company.com needs no caption above it.
   */
  labelHidden?: boolean;
  error?: FieldError;
  children: (id: string) => ReactNode;
}) {
  const id = useId();

  return (
    <Box width="full">
      {labelHidden ? (
        <VisuallyHidden asChild>
          <label htmlFor={id}>{label}</label>
        </VisuallyHidden>
      ) : (
        /* Centred when the label stands alone, because everything else on this
           card is: the title, the button's word, the divider, the method rail
           and the footer all sit on the centre line, and a lone label pinned
           left was the one thing that did not. It goes back to a two-ended row
           the moment there is something to put at the far end — a centred
           label with a link hanging off the right of it is not centred, it is
           two things fighting. */
        <HStack
          width="full"
          justify={labelEnd ? "space-between" : "center"}
          marginBottom="7px"
        >
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
      )}
      {children(id)}
      {error?.message ? (
        <Text
          fontSize="12.5px"
          lineHeight="1.5"
          marginTop="6px"
          color={"auth.danger"}
        >
          {error.message}
        </Text>
      ) : null}
    </Box>
  );
}

/** The focus treatment every auth-screen input shares: the brand's ring. */
export const FIELD_FOCUS = {
  borderColor: "auth.detail",
  boxShadow: "0 0 0 3px {colors.auth.focusRing}",
  outline: "none",
} as const;

/**
 * The surface every auth-screen input shares. The card is glass, so a field
 * sits one step more solid than the card it is on — enough for the type to
 * stay crisp with the ground moving underneath.
 */
export const FIELD_SURFACE = {
  backgroundColor: "auth.fieldBg",
  borderColor: "auth.fieldBorder",
} as const;
