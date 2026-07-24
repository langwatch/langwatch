/**
 * Compatibility layer: next/link → react-router Link
 */
import { Link as RouterLink, type LinkProps as RouterLinkProps } from "react-router";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

interface NextLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | { pathname: string; query?: Record<string, any> };
  as?: string;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
  children?: ReactNode;
}

function buildHref(
  href: string | { pathname: string; query?: Record<string, any> }
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
    children,
    ...rest
  },
  ref
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
    <RouterLink ref={ref} to={to} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
});

export default Link;
