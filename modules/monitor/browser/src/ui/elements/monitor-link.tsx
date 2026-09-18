/**
 * Link inside governed screens; navigates through host but uses real anchors
 * for compatibility.
 */

import { chakra } from "@chakra-ui/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { useMonitorHost } from "../../model/monitor-host.ts";

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
        const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (isModifiedClick) return;
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
