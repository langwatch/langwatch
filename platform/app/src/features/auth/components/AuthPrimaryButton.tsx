import { Button } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "../auth.css";
import { SHAPE } from "../authTheme";

/**
 * The one button that carries a auth-screen card forward, and the one place its
 * working state is described.
 *
 * Six screens were declaring the same eleven props inline — the class, the
 * full width, the 44 pixel target, the two brand colours and the hover — which
 * is how they came to disagree about what "busy" looks like. Some passed
 * `loading` and some did not, and the ones that did lost their label to a bare
 * spinner the moment somebody pressed them.
 *
 * ── What busy looks like here ───────────────────────────────────────────
 *
 * The label stays. Chakra's default swaps it for a spinner, which is the
 * worst version of this: the button's whole content changes width, the row
 * re-centres, and the one word telling somebody what they just set in motion
 * disappears at the exact moment they want to check it. `loadingText` keeps
 * the words and puts the spinner beside them, and because the button spans the
 * column its box never moves — only its contents re-centre inside it.
 *
 * It is disabled while it is busy, which is the other half: a submit that can
 * be pressed twice is a verification email sent twice, or two sign-in attempts
 * racing for one rate-limit budget.
 */
export function AuthPrimaryButton({
  type = "button",
  isBusy = false,
  isDisabled = false,
  onClick,
  testId,
  children,
}: {
  type?: "button" | "submit";
  /** In flight: the spinner joins the label, and the button stops taking
   *  presses. */
  isBusy?: boolean;
  /** Unavailable for a reason that is not busyness — a rate limit still
   *  counting down, most often. */
  isDisabled?: boolean;
  onClick?: () => void;
  testId?: string;
  /** The label. Kept on screen while the button is busy, so it must read as
   *  the thing being done rather than as an instruction. */
  children: ReactNode;
}) {
  return (
    <Button
      {...AUTH_PRIMARY_STYLE}
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

/**
 * Every value the primary action is made of, in one object.
 *
 * Exported because two callers cannot use the component and must still be the
 * same button: the sign-in error card's recovery, which is an ANCHOR (the
 * federated logout is a server route, so it has to leave the single-page app),
 * and the invitation landing's join, which sits in a row rather than spanning
 * a column. Both spread this, so a change to the button reaches them without
 * anybody remembering they exist — which is exactly how the card ended up with
 * six hand-copied versions of these props, and how they came to disagree.
 */
export const AUTH_PRIMARY_STYLE = {
  className: "lw-auth-primary",
  width: "full",
  minHeight: "44px",
  // The same size and weight the method rail is set in, because they are the
  // same kind of thing: a way through this card. A primary that shouted in a
  // heavier weight would be a different component wearing the colour.
  fontSize: "14px",
  fontWeight: 600,
  // The card's one radius language: the same cut as the box above it.
  borderRadius: SHAPE.control,
  backgroundColor: "auth.action",
  color: "auth.onAction",
  // Every state is a change of COLOUR. One step along the brand ramp on hover
  // — darker on paper, brighter on ink, because those are the same direction
  // seen from opposite grounds — and the press adds the half-pixel give the
  // stylesheet owns, so holding it down differs from pointing at it.
  _hover: { backgroundColor: "auth.actionHover" },
  _active: { backgroundColor: "auth.actionHover" },
  // The brand's own tint, and the same ring every field on this card takes, so
  // tabbing through the form never changes what focus looks like.
  // `focusVisible` rather than `focus`: a ring after a mouse click is the
  // browser answering a question nobody asked.
  _focusVisible: {
    outline: "none",
    boxShadow: "0 0 0 3px {colors.auth.focusRing}",
  },
  // Chakra dims a disabled button for us; what it cannot know is that this one
  // must not also look pressable. Stated so a rate-limited submit reads as
  // unavailable rather than as merely faint.
  _disabled: { cursor: "not-allowed", opacity: 0.55 },
} as const;
