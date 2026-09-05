/**
 * An in-application address, as an anchor, without reaching the router.
 * ADR-004 seals the router off from a feature package, so an internal address
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";

import { useOptionalUiCapabilities } from "./capabilities";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

/** Whether the browser should be left to handle this click itself. */
function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export const Link = ({ href, isExternal, children, onClick, ...props }: LinkProps) => {
  const capabilities = useOptionalUiCapabilities();

  if (isExternal) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink
      href={href ?? ""}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (isBrowserClick(event) || !href || !capabilities) return;
        event.preventDefault();
        capabilities.navigation.navigate(href);
      }}
      {...props}
    >
      {children}
    </ChakraLink>
  );
};

export default Link;
