/**
 * One entry of the analytics rail.
 *
 * A NARROWED copy of `platform/app/src/components/MenuLink`: what did not
 * travel is the pathname read that decided its own selected state. A governed
 * screen may not import a router, and the rail already knows which page it is
 * rendering — it is a prop of the layout — so selection arrives as `isSelected`
 * and the entry stops guessing. The annotations family narrowed the same
 * component the same way.
 *
 * The anchor is real, so a middle-click opens the page in a tab; an ordinary
 * left-click goes to the host's navigate.
 */

import { HStack, Link as ChakraLink, Spacer, Text } from "@chakra-ui/react";
import type { MouseEvent, PropsWithChildren, ReactNode } from "react";
import { useAnalyticsHost } from "../../model/analytics-host";

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

export const MenuLink = ({
  paddingX = 4,
  href,
  children,
  icon,
  menuEnd,
  isSelected = false,
  disabled,
}: PropsWithChildren<{
  paddingX?: number;
  href: string;
  icon?: ReactNode;
  menuEnd?: ReactNode;
  isSelected?: boolean;
  disabled?: boolean;
}>) => {
  const host = useAnalyticsHost();

  return (
    <ChakraLink
      href={href}
      paddingX={paddingX}
      paddingY={1}
      width="full"
      position="relative"
      borderRadius="lg"
      background={!disabled && isSelected ? "bg.muted" : "transparent"}
      _hover={!disabled ? { background: "bg.muted" } : void 0}
      aria-disabled={disabled || void 0}
      aria-current={isSelected ? "page" : void 0}
      tabIndex={disabled ? -1 : void 0}
      opacity={disabled ? 0.4 : void 0}
      cursor={disabled ? "not-allowed" : void 0}
      pointerEvents={disabled ? "none" : void 0}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      <HStack width="full" gap={2}>
        {icon}
        <Text>{children}</Text>
        <Spacer />
        {menuEnd}
      </HStack>
    </ChakraLink>
  );
};
