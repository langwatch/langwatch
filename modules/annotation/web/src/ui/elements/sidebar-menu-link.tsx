/**
 * Sidebar menu entry: selection passed by caller, not derived from route.
 * Narrowed local copy (see platform/app/src/components/MenuLink).
 */

import { HStack, Spacer, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Link } from "./annotation-link.tsx";

export function SidebarMenuLink({
  href,
  icon,
  menuEnd,
  isSelected,
  children,
  paddingX = 2.5,
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
      _hover={{ background: "bg.muted" }}
    >
      <HStack width="full" gap={2}>
        {icon}
        <Text>{children}</Text>
        <Spacer />
        {menuEnd}
      </HStack>
    </Link>
  );
}
