/**
 * ADR-004 seals `react-router` off from a feature package, and the one call site
 * here passes an `href` a browser can follow, so this is the Chakra link and
 * nothing else.
 */

import { Link as ChakraLink, type LinkProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * `isExternal` is accepted and turned into what it always meant.
 */
export function Link({
  isExternal,
  children,
  ...rest
}: LinkProps & { isExternal?: boolean; children?: ReactNode }) {
  return (
    <ChakraLink {...rest} {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </ChakraLink>
  );
}
