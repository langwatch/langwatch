/**
 * Sidebar menu entry: selection passed by caller, not derived from route.
 * Narrowed local copy (see platform/app/src/components/MenuLink).
 */

import { Link } from "@langwatch/browser-host/link";
import { HStack, Spacer, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function SidebarMenuLink({
  href,
  icon,
  menuEnd,
  isSelected,
  children,
  paddingX = 3,
}: {
  href: string;
  icon?: ReactNode;
  /** The trailing slot: a pending count, or the queue's own action trigger. */
  menuEnd?: ReactNode;
  isSelected: boolean;
  children: ReactNode;
  paddingX?: number;
}) {
  return (
    <Link
      href={href}
      paddingX={paddingX}
      paddingY={1}
      width="full"
      position="relative"
      borderRadius="lg"
      aria-current={isSelected ? "page" : void 0}
      background={isSelected ? "bg.muted" : "transparent"}
      fontWeight={isSelected ? "medium" : void 0}
      _hover={{ background: "bg.muted", textDecoration: "none" }}
    >
      <HStack width="full" gap={2}>
        {icon}
        <Text truncate>{children}</Text>
        <Spacer />
        {menuEnd}
      </HStack>
    </Link>
  );
}
