import { Button } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { SHAPE } from "../../model/front-door-theme.ts";

import "./auth-front-door.css";

/**
 * The one button that carries a front-door card forward. Busy keeps the label beside the
 * spinner and stops taking presses: a submit pressed twice is a second email or a second
 * attempt on one rate-limit budget. Spec: specs/identity/signin-signup-screens.feature.
 */
export function FrontDoorPrimaryButton({
  type = "button",
  isBusy = false,
  isDisabled = false,
  onClick,
  testId,
  children,
}: {
  type?: "button" | "submit";
  /** In flight: the spinner joins the label, and the button stops taking presses. */
  isBusy?: boolean;
  /** Unavailable for a reason that is not busyness, a rate limit still counting down most often. */
  isDisabled?: boolean;
  onClick?: () => void;
  testId?: string;
  /** The label, kept on screen while busy, so it reads as the thing being done. */
  children: ReactNode;
}) {
  return (
    <Button
      {...FRONT_DOOR_PRIMARY_STYLE}
      type={type}
      loading={isBusy}
      loadingText={children}
      disabled={isDisabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

/** The shape of a way through the card, with no colour in it: cut to the field's radius. */
export const FRONT_DOOR_ACTION_GEOMETRY = {
  width: "full",
  minHeight: "44px",
  fontSize: "14px",
  fontWeight: 600,
  borderRadius: SHAPE.control,
} as const;

/**
 * Every value the primary action is made of, for the two callers that cannot render the
 * component: an anchor that must leave the app, and a button sitting in a row. Every state
 * is a change of colour; the stylesheet owns the half-pixel press.
 */
export const FRONT_DOOR_PRIMARY_STYLE = {
  className: "lw-front-door-primary",
  ...FRONT_DOOR_ACTION_GEOMETRY,
  backgroundColor: "frontDoor.action",
  color: "frontDoor.onAction",
  _hover: { backgroundColor: "frontDoor.actionHover" },
  _active: { backgroundColor: "frontDoor.actionHover" },
  _focusVisible: {
    outline: "none",
    boxShadow: "0 0 0 2px {colors.bg}, 0 0 0 4px {colors.frontDoor.focusRing}",
  },
  _disabled: { cursor: "not-allowed", opacity: 0.55 },
} as const;
