/**
 * One entry in the annotations sidebar.
 *
 * A NARROWED FAMILY-LOCAL COPY of `platform/app/src/components/MenuLink`, which
 * keeps sixteen callers across the application and so did not travel.
 *
 * WHAT THE NARROWING TOOK OUT is the part that made the platform component
 * three components in one: it resolved "am I the current entry?" itself from
 * `usePathname` when the caller passed neither `isSelected` nor
 * `isSelectedAnnotation`, and it carried an `includePath` prefix rule and a
 * `disabled` state that no annotation entry uses. Selection here is always the
 * caller's answer, because the caller knows it without reading the address: the
 * screen was told which view it is.
 */

import { HStack, Spacer, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Link } from "./annotation-link";

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
