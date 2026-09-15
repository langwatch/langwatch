/**
 * An anchor, with the application's external-link behaviour.
 *
 * A family-local copy of `platform/app/src/components/ui/link.tsx`, which 85
 * other files import and which deletes-only forbids repointing. The one thing
 * dropped is the router-aware `NextLink` on the internal branch: a feature-web
 * package may not name a router, and the two addresses this screen links to are
 * a settings page and the docs. A plain anchor navigates both.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps } from "react";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

export const Link = ({ href, isExternal, children, ...props }: LinkProps) => {
  if (isExternal) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink href={href ?? ""} {...props}>
      {children}
    </ChakraLink>
  );
};
