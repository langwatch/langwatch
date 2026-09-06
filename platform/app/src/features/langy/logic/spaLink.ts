/**
 * SPA-safe link behaviour for Langy: every internal target must ride the SPA
 * router so the persistent Langy panel is never torn down by a full page load
 * (specs/langy/langy-navigation-persistence.feature,
 * specs/langy/langy-agent-driven-navigation.feature).
 */
import type { MouseEvent } from "react";

import { useRouter } from "~/utils/compat/next-router";

/**
 * Whether an href stays inside this app. Relative paths (`/project/traces`)
 * are internal and ride the SPA router; protocol-relative (`//evil.com`) and
 * absolute (`https://…`) URLs are external and must get a real navigation, so
 * a trace link inside the app stays SPA while a GitHub PR link opens for real.
 *
 * A backslash disqualifies the href too: browsers recover from `/\evil.com`
 * (or `\/evil.com`) by normalising `\` to `/`, so it resolves as the
 * protocol-relative `//evil.com` — an off-site jump wearing a leading slash.
 * The WHATWG URL spec doesn't sanction that, but real browsers do it, so the
 * guard rejects any backslash rather than trust a `startsWith("//")` check
 * that the browser is about to sidestep.
 *
 * Tab / newline / carriage-return are rejected for the same reason: the URL
 * parser STRIPS them before resolving, so `/\t/evil.com` collapses to
 * `//evil.com` and escapes the `startsWith("//")` check the same way. Reject
 * any C0 control character rather than enumerate the three the spec strips.
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
