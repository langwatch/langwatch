"use client";

import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { frontDoorThemeConfig } from "~/features/auth-front-door/frontDoorTheme";
import { ColorModeProvider, type ColorModeProviderProps } from "./color-mode";

/**
 * Chakra's default system plus the front door namespace, so the screens that
 * render here (the welcome flow and the guided takeover) can use the same
 * brand tokens as the sign-in screens. The namespace adds tokens and changes
 * nothing the default system already defines.
 */
const onboardingSystem = createSystem(defaultConfig, frontDoorThemeConfig);

export function Provider(props: ColorModeProviderProps) {
  return (
    <ChakraProvider value={onboardingSystem}>
      <ColorModeProvider {...props} />
    </ChakraProvider>
  );
}
