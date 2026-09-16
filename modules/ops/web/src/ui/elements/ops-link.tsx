/** Plain anchor (can't import Chakra link or react-router next-link). Supports
 * middle-click, works once hydrated. Gateway family same decision. */

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
 * The `next/link` call shape, which wraps its child rather than styling
 * it. Kept as its own export so the call sites that passed
 * `style={{ textDecoration: "none" }}` around a `<Text>` are the lines they were.
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
