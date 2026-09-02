/**
 * A link inside the navigation chrome.
 *
 * THE EIGHTH COPY OF A DOZEN LINES OF POLICY — `monitor-web`'s own header says
 * user-web, gateway-web, governance-web, organization-web and analytics-web all
 * carry it, and `platform/app`'s `components/ui/link` (the module this replaces)
 * is gone. A governed web package may not import a router by name
 * (`frontend-ui-boundaries` forbids `react-router` and `next/router`
 * explicitly), so navigation goes through the host and the anchor stays a real
 * `<a href>`: a middle click, a "copy link address" and a screen reader's link
 * list all need one.
 *
 * `isExternal` keeps the shape the sidebar and the support menu passed it:
 * an outward destination opens in a new tab and is NOT taken over, because the
 * host's router cannot route to it.
 *
 * An `href` of `undefined` renders the same anchor with nothing to follow. The
 * sidebar relies on it: an entry whose destination needs a project it does not
 * have renders dimmed and inert, and the tooltip says why.
 */

import { chakra } from "@chakra-ui/react";
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";
import { useNavigationHost } from "../../model/navigation-host";

const Anchor = chakra("a");

export type NavigationLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href?: string;
  isExternal?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
  /** Chakra style props travel, the way the module this replaces let them. */
  [key: string]: unknown;
};

export function NavigationLink({
  href,
  isExternal,
  children,
  onClick,
  ref,
  ...props
}: NavigationLinkProps) {
  const host = useNavigationHost();

  if (isExternal) {
    return (
      <Anchor
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        {...props}
      >
        {children}
      </Anchor>
    );
  }

  return (
    <Anchor
      ref={ref}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // A modified click is the reader asking the BROWSER for a new tab or
        // window; taking it over would be taking that away.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        if (href === void 0) return;
        event.preventDefault();
        host.navigate(href);
      }}
      {...props}
    >
      {children}
    </Anchor>
  );
}
