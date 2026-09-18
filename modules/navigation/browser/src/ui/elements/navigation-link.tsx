/** Shared across web packages. External links open new tabs; undefined href renders inert. */

import { chakra } from "@chakra-ui/react";
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { useNavigationHost } from "../../model/navigation-host.ts";

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
        const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (isModifiedClick) return;
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
