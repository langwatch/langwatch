"use client";

import type { ChakraProviderProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ColorModeProvider, type ColorModeProviderProps } from "../color-mode/index.tsx";
import { useInputModality } from "../overlays/input-modality.ts";
import { system as defaultDesignSystem } from "../system/index.ts";
import { SystemProvider } from "./system-provider.tsx";

export { useIsDevelopment } from "./environment.ts";

export type DesignSystemProviderProps = ColorModeProviderProps & {
  children?: ReactNode;
  system?: ChakraProviderProps["value"];
  /** A development build: overlay error fallbacks show the raw crash text. Production otherwise. */
  isDevelopment?: boolean;
};

export function DesignSystemProvider({
  children,
  system = defaultDesignSystem,
  isDevelopment = false,
  ...colorModeProps
}: DesignSystemProviderProps) {
  useInputModality();
  return (
    <SystemProvider system={system} isDevelopment={isDevelopment}>
      <ColorModeProvider {...colorModeProps}>{children}</ColorModeProvider>
    </SystemProvider>
  );
}
