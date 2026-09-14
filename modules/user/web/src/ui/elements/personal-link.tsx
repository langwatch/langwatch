/**
 * Link element for feature-web packages (no router import).
 * Keeps anchor affordances; left-click routes through host.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

/** A click the browser handles itself: a new tab, a download, a modified click. */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
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
  const host = usePersonalWorkspaceHost();

  if (isExternal) {
    return (
      <ChakraLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        {...props}
      >
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink
      href={href ?? ""}
      onClick={(event) => {
        onClick?.(event);
        if (href === void 0 || opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
      {...props}
    >
      {children}
    </ChakraLink>
  );
};
