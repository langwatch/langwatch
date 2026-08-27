/**
 * Compatibility layer: next/link → react-router Link
 */

import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";

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

  // External links
  if (to.startsWith("http://") || to.startsWith("https://") || to.startsWith("mailto:")) {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink
      ref={ref}
      to={to}
      replace={replace}
      viewTransition={viewTransition}
      {...rest}
    >
      {children}
    </RouterLink>
  );
});

export default Link;
