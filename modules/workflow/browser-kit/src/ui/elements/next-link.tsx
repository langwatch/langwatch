/**
 * Compatibility layer: next/link → the family's navigation port.
 * Renders a real anchor; plain clicks hand off to WorkflowHostApi.navigate.
 */

import { type AnchorHTMLAttributes, forwardRef, type MouseEvent, type ReactNode } from "react";

import { useOptionalWorkflowHost } from "../../model/workflow-host.ts";

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

function buildHref(href: string | { pathname: string; query?: Record<string, any> }): string {
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
    viewTransition: _viewTransition,
    children,
    ...rest
  },
  ref,
) {
  const to = buildHref(href);

  // External links
  const isExternal =
    to.startsWith("http://") || to.startsWith("https://") || to.startsWith("mailto:");
  if (isExternal) {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <HostAnchor ref={ref} to={to} replace={replace} rest={rest}>
      {children}
    </HostAnchor>
  );
});

/** Whether the browser should be left to handle this click itself. */
function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

const HostAnchor = forwardRef<
  HTMLAnchorElement,
  {
    to: string;
    replace?: boolean;
    rest: AnchorHTMLAttributes<HTMLAnchorElement>;
    children?: ReactNode;
  }
>(function HostAnchor({ to, replace: _replace, rest, children }, ref) {
  const host = useOptionalWorkflowHost();
  return (
    <a
      ref={ref}
      href={to}
      {...rest}
      onClick={(event) => {
        rest.onClick?.(event);
        // No host mounted: the anchor is left to the browser.
        if (isBrowserClick(event) || !host) return;
        event.preventDefault();
        host.navigate(to);
      }}
    >
      {children}
    </a>
  );
});

export default Link;
