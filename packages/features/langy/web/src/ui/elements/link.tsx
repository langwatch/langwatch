/**
 * A link, as the model pill spells it.
 *
 * `~/components/ui/link` was the application's Chakra link bound to its router.
 * ADR-004 seals `react-router` off from a feature package, and the one call site
 * here passes an `href` a browser can follow, so this is the Chakra link and
 * nothing else.
 */

import { Link as ChakraLink, type LinkProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * `isExternal` is accepted and turned into what it always meant.
 *
 * Chakra v2 took the prop and Chakra v3 dropped it; the application's own link
 * kept answering it. The model pill passes it, and what it wants is a new tab
 * with the opener severed, so that is what it sets.
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
