import { Link } from "@langwatch/browser-host/link";
import { Box } from "@langwatch/design-system/primitives";

import { SHAPE } from "../../model/front-door-theme.ts";

/**
 * The one look every secondary link on a front-door card shares: the foreground at medium
 * weight so it reads as a link, an underline only when pointed at, one size everywhere.
 */
export const FRONT_DOOR_LINK_STYLE = {
  display: "inline-block",
  fontSize: "13px",
  fontWeight: 500,
  color: "fg",
  textDecoration: "none",
  _hover: { textDecoration: "underline", textUnderlineOffset: "3px" },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "frontDoor.focusRing",
    outlineOffset: "2px",
    borderRadius: SHAPE.field,
  },
} as const;

/**
 * The way to the OTHER screen, quiet on purpose: one centred line under the primary action,
 * saying the action outright ("Or log in instead"). An anchor, because it goes somewhere.
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
    <Box width="full" textAlign="center" paddingTop="1">
      <Box asChild {...FRONT_DOOR_LINK_STYLE} data-testid={testId}>
        <Link href={href}>{label}</Link>
      </Box>
    </Box>
  );
}
