/**
 * The one in-app link: a real anchor whose plain click routes in place through
 * the navigation capability (§10), so the document never reloads.
 * Spec: specs/ui/in-app-links.feature
 */

import { Link as ChakraLink } from "@langwatch/design-system/primitives";
import type { ComponentProps, MouseEvent } from "react";

import { useOptionalUiCapabilities } from "./capabilities.ts";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

/** The API's own addresses, which the browser must load as a document. */
const SERVER_PATH = /^\/api(?:[/?#]|$)/;

/** Whether this address is a page of this application, which the router serves. */
function isInAppHref(href: string | undefined): href is string {
  if (!href?.startsWith("/") || href.startsWith("//")) return false;
  return !href.includes("\\") && !SERVER_PATH.test(href);
}

/** Whether the browser should be left to handle this click itself. */
function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const { target } = event.currentTarget;
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== "" && target !== "_self") ||
    event.currentTarget.hasAttribute("download")
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
        if (isBrowserClick(event) || !isInAppHref(href) || !capabilities) return;
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
