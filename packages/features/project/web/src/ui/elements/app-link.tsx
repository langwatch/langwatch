/**
 * A link inside the application.
 *
 * A REAL `<a href>`, not a button: middle-click, "open in new tab" and the
 * status bar are what a link is for, and a click handler loses all three. The
 * host's navigation takes the plain click so the page swaps without a document
 * load; every modified click is left to the browser.
 *
 * `platform/app`'s `components/ui/link` wrapped a router `Link`. A governed web
 * package may not import a router (`frontend-ui-boundaries` forbids it by
 * name), so the anchor is ours and the navigation is the host's — the eighth
 * copy of the dozen lines `@langwatch/navigation-web`'s own header counts.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";
import { useProjectHomeHost } from "../../model/project-home-host";

export type AppLinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

export function Link({ href, isExternal, children, onClick, ...props }: AppLinkProps) {
  const host = useProjectHomeHost();

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
        if (event.defaultPrevented) return;
        // Every modified click stays the browser's: a new tab, a new window and
        // a download are all things the reader asked the BROWSER for.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        host.navigate(href ?? "");
      }}
      {...props}
    >
      {children}
    </ChakraLink>
  );
}

export default Link;
