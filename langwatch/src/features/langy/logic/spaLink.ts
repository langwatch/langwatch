/**
 * SPA-safe link behaviour for Langy: every internal target must ride the SPA
 * router so the persistent Langy panel is never torn down by a full page load
 * (specs/langy/langy-navigation-persistence.feature,
 * specs/langy/langy-agent-driven-navigation.feature).
 */
import type { MouseEvent } from "react";

// THE internal-href guard (backslash + C0 hardening lives with its docs
// there) — one notion of "internal", shared with markdown links and the
// SPA anchor. Never fork it.
import { isInternalHref } from "~/components/Markdown";
import { useRouter } from "~/utils/compat/next-router";


/**
 * Click handler for a real `<a>` whose plain left-click should SPA-navigate.
 *
 * Keeps the real anchor semantics: cmd/ctrl/shift/alt-click and middle-click
 * still open a new tab, right-click still offers "open in new tab". Intercepts
 * ONLY a plain left click on an in-app link, and `router.push`es it instead of
 * full-reloading — an external href is left entirely to the browser.
 */
export function useSpaLinkClick(
  href: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
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
