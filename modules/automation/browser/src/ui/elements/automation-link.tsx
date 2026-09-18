// In-application link: plain anchor instead of router Link (feature-web can't import router);
// trades client-side transition for portability.

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
