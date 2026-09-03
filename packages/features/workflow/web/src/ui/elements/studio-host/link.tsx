/**
 * The link the moved studio modules already render.
 *
 * `platform/app`'s `components/ui/link` wraps Chakra's `Link` around the
 * router's own anchor so an in-app address is a client navigation. A
 * feature-web package may not import the router, so an internal address is an
 * anchor whose click is handed to `WorkflowHostPort.navigate` — the same
 * navigation, asked through the one port the family declares. Modifier-clicks
 * and middle-clicks fall through to the browser, so "open in a new tab" still
 * works on every link in the studio.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";

import { useOptionalWorkflowHost } from "../../../model/workflow-host";

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
  const host = useOptionalWorkflowHost();

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
        // No host mounted: the anchor is left to the browser, which is a full
        // page load to the same address rather than a dead link.
        if (isBrowserClick(event) || !href || !host) return;
        event.preventDefault();
        host.navigate(href);
      }}
      {...props}
    >
      {children}
    </ChakraLink>
  );
};

export default Link;
