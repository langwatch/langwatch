/**
 * A real `<a href>` link, not a button; middle-click and status bar work.
 * Host navigation handles plain clicks; browser handles modified clicks.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";

import { useProjectHomeHost } from "../../model/project-home-host.ts";

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
        const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (isModifiedClick) return;
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
