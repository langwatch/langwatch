"use client";

import { ChakraProvider, type ChakraProviderProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { ColorModeProvider, type ColorModeProviderProps } from "../color-mode";
import { system as defaultDesignSystem } from "../system";

export type DesignSystemProviderProps = ColorModeProviderProps & {
  children?: ReactNode;
  system?: ChakraProviderProps["value"];
};

export function DesignSystemProvider({
  children,
  system = defaultDesignSystem,
  ...colorModeProps
}: DesignSystemProviderProps) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider {...colorModeProps}>{children}</ColorModeProvider>
    </ChakraProvider>
  );
}
