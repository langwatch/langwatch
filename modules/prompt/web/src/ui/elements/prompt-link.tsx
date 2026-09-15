/**
 * An anchor, with the application's external-link behaviour. A family-local
 * copy of the shared link, dropping the router-aware `NextLink` branch since
 * a feature-web package may not name a router.
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
