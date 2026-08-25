import { Box } from "@chakra-ui/react";
import Link from "~/utils/compat/next-link";
import "../auth.css";
import { SHAPE } from "../authTheme";

/**
 * The way to the OTHER screen — sign-up from log-in, log-in from sign-up —
 * quiet on purpose.
 *
 * It sits directly under the primary action, and it is not a peer of it: one
 * person in a hundred needs to switch screens, everyone else needs the filled
 * pill. So it is a single centered line, muted at rest, reading as a link —
 * never a second button competing for the first glance, and never a stray
 * left-aligned caption.
 *
 * Not a `MethodButton`: a method is a way to finish THIS screen; this is a
 * way to leave it for another. It says the action outright — "Create an
 * account", "Log in instead" — because its words have to work without the
 * sentence that used to lead into them.
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
    <Box width="full" textAlign="center" paddingY="1">
      <Box
        asChild
        display="inline-block"
        fontSize="13px"
        fontWeight={500}
        color="fg.muted"
        transition="color 0.15s ease"
        _hover={{
          color: "fg",
          textDecoration: "underline",
          textUnderlineOffset: "3px",
        }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "fg.subtle",
          outlineOffset: "2px",
          borderRadius: SHAPE.control,
        }}
        data-testid={testId}
      >
        <Link viewTransition href={href}>
          {label}
        </Link>
      </Box>
    </Box>
  );
}
