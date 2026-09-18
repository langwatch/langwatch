/**
 * In-app link for billing screens; plain anchor avoids router import that
 * feature-web packages can't make.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps } from "react";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

export function Link({ href, isExternal, children, ...props }: LinkProps) {
  return (
    <ChakraLink
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {children}
    </ChakraLink>
  );
}
