/**
 * A link, as this package renders one.
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

function toHref(href: NextLinkProps["href"]): string {
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
