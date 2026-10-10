import { HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Drawer } from "./drawer.tsx";

export interface DetailDrawerHeaderProps {
  /** A decorative icon, normally 14px. */
  icon?: ReactNode;
  kind: string;
  title: ReactNode;
  /** Context, protocol and status badges; wraps on narrow drawers. */
  children?: ReactNode;
}

/** Entity identity inside Drawer.Header; the host owns padding and close controls. */
export function DetailDrawerHeader({ icon, kind, title, children }: DetailDrawerHeaderProps) {
  return (
    <VStack align="stretch" gap={3}>
      <HStack color="fg.muted" gap={2} fontSize="xs">
        {icon}
        <Text>{kind}</Text>
      </HStack>
      <Drawer.Title overflowWrap="anywhere">{title}</Drawer.Title>
      {children != null && (
        <HStack gap={2} flexWrap="wrap">
          {children}
        </HStack>
      )}
    </VStack>
  );
}
