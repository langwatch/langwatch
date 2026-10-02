import { Link } from "@langwatch/browser-host/link";
import { Box } from "@langwatch/design-system/primitives";

import { SHAPE } from "../../model/front-door-theme.ts";

/**
 * The way to the OTHER screen, quiet on purpose: one centred muted line under
 * the primary action, saying the action outright ("Or log in instead"). An
 * anchor, because it goes somewhere.
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
      <Box
        asChild
        display="inline-block"
        fontSize="13px"
        fontWeight={500}
        color="fg.muted"
        transition="color 0.15s ease"
        _hover={{ color: "fg", textDecoration: "underline", textUnderlineOffset: "3px" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "fg.subtle",
          outlineOffset: "2px",
          borderRadius: SHAPE.field,
        }}
        data-testid={testId}
      >
        <Link href={href}>{label}</Link>
      </Box>
    </Box>
  );
}
