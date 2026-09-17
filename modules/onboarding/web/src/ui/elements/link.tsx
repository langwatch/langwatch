/**
 * Anchors (not react-router) since feature-web can't import react-router and
 * onboarding links change app state; prop shape preserves call sites.
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
