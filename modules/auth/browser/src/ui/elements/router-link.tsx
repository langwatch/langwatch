/** Front-door link as plain anchor; full navigation, not client transition. */

import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from "react";

/** A value `buildHref` writes into the query string. */
type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | { pathname: string; query?: Record<string, QueryValue> };
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
  href: string | { pathname: string; query?: Record<string, QueryValue> },
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
