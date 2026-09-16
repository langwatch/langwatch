/**
 * A link, inside a package that may not import a router: ADR-004 seals
 * off `react-router` here, so this keeps a plain anchor and hands
 * left-click to the host's navigate — the sixth copy of this policy.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";
import { useAnalyticsHost } from "../../model/analytics-host.ts";

type LinkProps = {
  href: string | undefined;
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

export const Link = ({ href, children, onClick, ...props }: LinkProps) => {
  const host = useAnalyticsHost();

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
