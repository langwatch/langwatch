import { Button } from "@chakra-ui/react";
import Link from "~/utils/compat/next-link";
import "../auth.css";
import { SHAPE } from "../authTheme";

/**
 * The way to the OTHER screen — sign-up from log-in, log-in from sign-up —
 * drawn as a button rather than as a sentence.
 *
 * It used to be a line of muted text with the last two words underlined, and
 * it sat directly under the primary action, which is the one place on this
 * card where a sentence has to compete with a filled pill for the same glance.
 * It lost every time: the card read as one action with a caption, and the
 * second way through was the least visible thing on a screen that only offers
 * two. As a button the card reads as what it is — a primary and an
 * alternative — and the column stops being top-heavy.
 *
 * Not a `MethodButton`, and deliberately unlike one. A method is a way to
 * finish THIS screen; this is a way to leave it for another. So it carries no
 * mark on the left rail (every seat in the method rail does), and it says the
 * action outright — "Create an account" rather than "Sign up" answering a
 * question that is no longer asked, because a button's words have to work
 * without the sentence that used to lead into them.
 *
 * An anchor, not a button that navigates: it goes somewhere, so it is
 * something to open in a new tab, copy, and see the destination of on hover.
 */
export function SecondaryActionLink({
  href,
  label,
  testId,
}: {
  href: string;
  /** The action itself, in the imperative. Never a question. */
  label: string;
  testId?: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      width="full"
      minHeight="44px"
      fontSize="14px"
      fontWeight={600}
      borderRadius={SHAPE.control}
      // The method rail's shell, so the card has one outline treatment rather
      // than two that nearly match.
      borderColor="auth.fieldBorder"
      _hover={{
        backgroundColor: "auth.fieldBg",
        borderColor: "fg.subtle",
      }}
      data-testid={testId}
    >
      <Link viewTransition href={href}>
        {label}
      </Link>
    </Button>
  );
}
