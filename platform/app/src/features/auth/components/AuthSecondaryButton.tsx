import { Button } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { AUTH_ACTION_GEOMETRY } from "./AuthPrimaryButton";
import "../auth.css";

/**
 * The second way through a card, in the primary's shape and not its colour.
 *
 * A card that offers "send the confirmation link" above "use a different
 * email" is offering two ways on. They are the same kind of thing, so they
 * have to be the same object — same height, same corner, same type — and
 * differ only in how loudly they are painted. Before this they did not: the
 * second was a bare Chakra `Button` taking the theme's default height, while
 * the primary hardcoded a 44 pixel target and a fully-rounded pill that
 * `authTheme.ts` had already ruled off this card. Stacked, one read as a
 * control and the other as an afterthought.
 *
 * Both spread {@link AUTH_ACTION_GEOMETRY}, so the pair cannot drift apart
 * again by one of them being edited. That is the same failure the primary's own
 * docblock describes, one component along.
 *
 * NOT a quieter primary. It carries a real alternative — going back to change
 * the address, declining an offer — so it keeps the full target size and the
 * same focus ring. What makes it secondary is that it is not filled with the
 * brand colour, which is the one difference a person needs to read.
 */
export function AuthSecondaryButton({
  type = "button",
  isDisabled = false,
  onClick,
  testId,
  children,
}: {
  type?: "button" | "submit";
  isDisabled?: boolean;
  onClick?: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Button
      {...AUTH_SECONDARY_STYLE}
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

/**
 * Exported for the same reason the primary's is: a caller that has to be this
 * button without being this component should spread the values rather than
 * copy them.
 */
export const AUTH_SECONDARY_STYLE = {
  ...AUTH_ACTION_GEOMETRY,
  variant: "ghost" as const,
  // `auth.action` is the ink-on-paper / paper-on-ink pair the primary is
  // FILLED with, so as a text colour it is the card's own foreground at full
  // contrast on either ground. A second way on that is greyed reads as
  // disabled, which is the one thing it is not.
  color: "auth.action",
  // The card's surface one step down — the wash the fields already sit on —
  // so hovering lifts it out of the card without painting it a new colour.
  _hover: { backgroundColor: "auth.fieldBg" },
  _active: { backgroundColor: "auth.fieldBg" },
  // Identical to the primary's, so tabbing between the two does not change
  // what focus looks like halfway down the card.
  _focusVisible: {
    outline: "none",
    boxShadow: "0 0 0 3px {colors.auth.focusRing}",
  },
  _disabled: { cursor: "not-allowed", opacity: 0.55 },
} as const;
