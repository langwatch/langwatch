/**
 * A link, as this package renders one.
 *
 * `~/utils/compat/next-link` wraps react-router's `Link`, which ADR-004 seals
 * off from a feature package — the same substitution the auth front door made,
 * and for the same reason: nothing this package links to is inside its own
 * screen, so a full navigation is what the reader wants anyway. The prop shape,
 * object `href` included, is unchanged.
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; query?: Record<string, string | number | undefined> };
  children?: ReactNode;
  shallow?: boolean;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
};

function toHref(
  href: NextLinkProps["href"],
): string {
  if (typeof href === "string") return href;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value !== void 0) search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${href.pathname ?? ""}?${queryString}` : (href.pathname ?? "");
}

export default function NextLink({
  href,
  children,
  shallow: _shallow,
  replace: _replace,
  scroll: _scroll,
  prefetch: _prefetch,
  ...rest
}: NextLinkProps) {
  return (
    <a href={toHref(href)} {...rest}>
      {children}
    </a>
  );
}
