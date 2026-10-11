import { Link } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

/** Prose links use ink with an orange underline; the label remains legible without colour. */
export function DocsLink({ href, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      color="fg"
      fontWeight="500"
      textDecorationColor="accent.fg"
      textDecoration="underline"
      textUnderlineOffset="2px"
      _hover={{ textDecoration: "underline" }}
      {...rest}
    >
      {children}
    </Link>
  );
}
