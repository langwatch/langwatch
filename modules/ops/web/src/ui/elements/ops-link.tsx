/**
 * A link, in a package that has no router.
 *
 * `platform/app`'s Ops surfaces reached for two of them — `~/components/ui/link`
 * (a Chakra anchor) and `~/utils/compat/next-link` (the Next-shaped one that
 * calls `navigate`) — and neither may travel: one is an application component,
 * the other imports react-router. Both were, at the point of use, an anchor
 * carrying an href, so this is one element with both call shapes.
 *
 * A plain anchor rather than a host action on purpose. It is what the compat
 * link renders anyway once react-router has hydrated the page, an operator's
 * middle click keeps working, and the alternative — a button that asks the host
 * to navigate — is a link that cannot be opened in a new tab, which is the one
 * thing an operator does with a link into another ops page.
 *
 * The gateway family took the same decision for the same reason
 * (`ui/elements/gateway-link.tsx`).
 */

import { Link as ChakraLink, type LinkProps as ChakraLinkProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

export type OpsLinkProps = Omit<ChakraLinkProps, "href"> & {
  href: string;
  children: ReactNode;
};

export function Link({ href, children, ...props }: OpsLinkProps) {
  return (
    <ChakraLink href={href} {...props}>
      {children}
    </ChakraLink>
  );
}

/**
 * The `next/link` call shape, which wraps its child rather than styling it.
 *
 * Kept as its own export so the call sites that passed `style={{ textDecoration:
 * "none" }}` around a `<Text>` are the lines they were.
 */
export function OpsNextLink({
  href,
  children,
  style,
}: {
  href: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <ChakraLink href={href} style={style}>
      {children}
    </ChakraLink>
  );
}

export default OpsNextLink;
