/**
 * SPA-safe link behaviour for Langy: every internal target must ride the SPA router so the persistent Langy panel
 * is never torn down by a full page load (specs/langy/langy-navigation-persistence.feature,
 * specs/langy/langy-agent-driven-navigation.feature).
 */
import type { MouseEvent } from "react";

import { useRouter } from "@langwatch/ui-host/use-router";

/**
 * Whether an href stays inside this app.
 */
// eslint-disable-next-line no-control-regex -- intentionally matching C0 controls
const CONTROL_CHARS = /[\u0000-\u001f]/;

export function isInternalHref(href: string): boolean {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes("\\") &&
    !CONTROL_CHARS.test(href)
  );
}

/**
 * Click handler for a real `<a>` whose plain left-click should SPA-navigate.
 */
export function useSpaLinkClick(href: string): (event: MouseEvent<HTMLAnchorElement>) => void {
  const router = useRouter();
  return (event) => {
    if (!isInternalHref(href)) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void router.push(href);
  };
}
