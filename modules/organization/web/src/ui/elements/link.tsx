/**
 * An in-application link, as the organization screens render one.
 *
 * `platform/app`'s `~/components/ui/link` wrapped Chakra's anchor around the
 * router's own `Link`, which is a router import a feature-web package may not
 * make. A plain anchor navigates to the same address; what it gives up is the
 * client-side transition, and that is the same trade the gateway, automation,
 * coding-agent, annotation and licensing families made.
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
