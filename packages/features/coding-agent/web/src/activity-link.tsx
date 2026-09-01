/**
 * A link, inside a package that may not import a router.
 *
 * `platform/app`'s `~/components/ui/link` renders its internal href through
 * `react-router`'s Link, which is an import ADR-004 seals off from a
 * feature-web package. So this one keeps the anchor, which is what makes a link
 * a link (open in a new tab, copy the address, middle-click), and hands an
 * ordinary left-click to the host's navigate so the page still changes without
 * a full reload.
 *
 * The prop shape is the platform component's, so no call site changed. The
 * gateway and governance families carry the same element; it is a dozen lines
 * of policy rather than a component worth a shared package of its own.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host";

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
  const host = useCodingAgentActivityHost();

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
