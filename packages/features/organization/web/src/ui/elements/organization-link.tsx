/**
 * A link, inside a package that may not import a router.
 *
 * `platform/app`'s `~/components/ui/link` renders its internal href through
 * `react-router`'s Link, which is an import ADR-004 seals off from a
 * feature-web package. So this one keeps the anchor, which is what makes a link
 * a link (open in a new tab, copy the address, middle-click), and hands an
 * ordinary left-click to the host's navigate so the page still changes without
 * a full reload.
 *
 * The fifth copy of a dozen lines of policy — user-web, gateway-web and
 * governance-web carry the same one — rather than a component worth a shared
 * package of its own. A web package may not import another web package, so the
 * alternative is a surface on one of them publishing twelve lines.
 */

import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps, MouseEvent } from "react";
import { useOrganizationHost } from "../../model/organization-host";

type LinkProps = {
  href: string | undefined;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

/** A click the browser handles itself: a new tab, a download, a modified click. */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export const Link = ({ href, children, onClick, ...props }: LinkProps) => {
  const host = useOrganizationHost();

  return (
    <ChakraLink
      href={href ?? ""}
      onClick={(event) => {
        onClick?.(event);
        if (href === void 0 || opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
      {...props}
    >
      {children}
    </ChakraLink>
  );
};
