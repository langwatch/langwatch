/**
 * A link out of a front-door screen.
 *
 * Harvested from `platform/app/src/utils/compat/next-link.tsx`, which wraps
 * react-router's `Link`. A feature-web package may not import the router
 * (ADR-004), so every destination is an anchor here — which on THIS family is
 * the right answer rather than a concession: the front door's own links move
 * between signed-out documents (`/auth/signin` ⇄ `/auth/signup`, forgot
 * password, an invitation), and every one of them wants the fresh document a
 * full navigation gives rather than a client transition carrying a cache
 * primed before there was a session.
 *
 * The prop shape is unchanged, including the object `href` and the
 * next/link-era props nothing reads, so no call site moved a character.
 */

import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from "react";

interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | { pathname: string; query?: Record<string, any> };
  as?: string;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
  /** Opt this navigation into the browser's view transition, so elements
   *  sharing a `view-transition-name` morph between the two pages. Ignored
   *  for external links and by browsers without the API. */
  viewTransition?: boolean;
  children?: ReactNode;
}

function buildHref(
  href: string | { pathname: string; query?: Record<string, any> },
): string {
  if (typeof href === "string") return href;
  const { pathname, query } = href;
  if (!query || Object.keys(query).length === 0) return pathname;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(function Link(
  {
    href,
    as: _as,
    replace,
    scroll: _scroll,
    shallow: _shallow,
    passHref: _passHref,
    prefetch: _prefetch,
    locale: _locale,
    legacyBehavior: _legacyBehavior,
    viewTransition,
    children,
    ...rest
  },
  ref,
) {
  const to = buildHref(href);
  void replace;
  void viewTransition;

  return (
    <a ref={ref} href={to} {...rest}>
      {children}
    </a>
  );
});

export default Link;
export { Link };
