"use client";

import { ChakraProvider, type ChakraProviderProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { DesignSystemEnvironmentProvider } from "./environment.ts";

export type SystemProviderProps = {
  children?: ReactNode;
  system: ChakraProviderProps["value"];
  /** A development build: overlay error fallbacks show the raw crash text. Production otherwise. */
  isDevelopment?: boolean;
};

/**
 * The design system with a system the caller built and no colour-mode provider: for a page that
 * owns its own light and dark switch. `DesignSystemProvider` is this plus the default system and
 * colour mode.
 */
export function SystemProvider({ children, system, isDevelopment = false }: SystemProviderProps) {
  return (
    <ChakraProvider value={system}>
      <DesignSystemEnvironmentProvider value={{ isDevelopment }}>
        {children}
      </DesignSystemEnvironmentProvider>
    </ChakraProvider>
  );
}
