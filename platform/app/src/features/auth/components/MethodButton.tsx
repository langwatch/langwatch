import { Box, Button, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "../auth.css";
import { SHAPE } from "../authTheme";

/**
 * One seat in the rail of ways in.
 *
 * Every method on the auth screens — a provider hand-off, a passkey ceremony —
 * is the same offer said with a different mark, so it is the same button.
 * Three fixed seats: the mark on the left rail, the words centred, the badge
 * (if any) floated on the right. A label centres on the same axis whatever
 * sits beside it, which is what lets the rail read as one column of choices
 * rather than a stack of separately-styled buttons.
 *
 * The shell is shared rather than copied because the rail is only legible
 * while the seats agree. A passkey button that centred its own icon-and-label
 * pair, at the field radius instead of the action one, was visibly a
 * different kind of thing sitting under three that matched.
 */
export function MethodButton({
  icon,
  label,
  badge,
  isBusy,
  isStandingBack = false,
  onClick,
  testId,
}: {
  /** The provider's mark, or the ceremony's. Sits on the left rail. */
  icon: ReactNode;
  label: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
  isBusy?: boolean;
  /**
   * Another method's ceremony is running, so this one stands back: dimmed and
   * unclickable until it returns.
   *
   * The reason is not tidiness. A WebAuthn prompt is a system sheet over the
   * page, and a rail of live buttons under it invites a second hand-off on top
   * of the first — two ceremonies racing, one of which will land somebody
   * somewhere they did not choose. Dimming says which one thing is happening.
   */
  isStandingBack?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      width="full"
      minHeight="44px"
      position="relative"
      fontSize="14px"
      fontWeight={600}
      borderRadius={SHAPE.control}
      justifyContent="center"
      overflow="visible"
      borderColor="auth.fieldBorder"
      _hover={{
        backgroundColor: "auth.fieldBg",
        borderColor: "fg.subtle",
      }}
      loading={isBusy}
      // Both, explicitly. A button showing a spinner that can still be pressed
      // fires the ceremony twice, and relying on the loading prop to imply the
      // disabled one leaves that to a library detail.
      disabled={isStandingBack || isBusy}
      // Enough to read as "not now", not so much that the rail looks broken.
      // The transition is what makes it read as the card settling rather than
      // as three buttons blinking out; it is a colour and opacity change only,
      // so it costs nothing under reduced motion and moves nothing on screen.
      opacity={isStandingBack ? 0.45 : undefined}
      transition="opacity 160ms ease"
      data-standing-back={isStandingBack ? "true" : undefined}
      onClick={onClick}
      data-testid={testId}
    >
      <Box position="absolute" insetInlineStart="16px" display="flex">
        {icon}
      </Box>
      <Text>{label}</Text>
      {badge ? <span className="lw-auth-badge-float">{badge}</span> : null}
    </Button>
  );
}
