import React, { type PropsWithChildren } from "react";
import { Text } from "@chakra-ui/react";

export function SmallLabel({ children }: PropsWithChildren) {
  return (
    <Text fontSize={11} fontWeight="bold" textTransform="uppercase">
      {children}
    </Text>
  );
}
