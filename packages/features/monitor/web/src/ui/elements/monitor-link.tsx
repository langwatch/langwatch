/**
 * A link inside a governed screen.
 *
 * THE SEVENTH COPY OF A DOZEN LINES OF POLICY — user-web, gateway-web,
 * governance-web, organization-web and analytics-web all carry the same one,
 * and `platform/app`'s `utils/compat/next-link` has seventy-odd importers a
 * deletes-only pass may not repoint. Seven is well past the point at which a
 * surface publishing twelve lines is cheaper than the next copy; recorded here
 * rather than built, because a page move does not own the Design System's
 * boundary.
 *
 * Navigation goes through the host so the application decides how a route
 * change happens, but the anchor is a real `<a href>`: a middle click, a
 * "copy link address" and a screen reader's link list all need one.
 */

import { chakra } from "@chakra-ui/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { useMonitorHost } from "../../model/monitor-host";

const Anchor = chakra("a");

export type MonitorLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export function MonitorLink({ href, children, onClick, ...props }: MonitorLinkProps) {
  const host = useMonitorHost();

  return (
    <Anchor
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // A modified click is the reader asking the BROWSER for a new tab or
        // window; taking it over would be taking that away.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        host.navigate(href);
      }}
      {...props}
    >
      {children}
    </Anchor>
  );
}
