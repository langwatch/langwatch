import { Link } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

/** Prose links: blue, underlined with a 2px offset; absolute http links keep their own tab policy. */
export function DocsLink({ href, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link href={href} color="blue.fg" textDecoration="underline" textUnderlineOffset="2px" _hover={{ textDecoration: "underline" }} {...rest}>
      {children}
    </Link>
  );
}
