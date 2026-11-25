import { createContext, useContext } from "react";

/**
 * What the composing application knows about its build and this package cannot read. The shell
 * says it once, through `DesignSystemProvider`; overlays read it for their error fallback.
 */
const DesignSystemEnvironmentContext = createContext<{ isDevelopment: boolean }>({
  isDevelopment: false,
});

export const DesignSystemEnvironmentProvider = DesignSystemEnvironmentContext.Provider;

/** True only when the shell said this is a development build; production otherwise. */
export function useIsDevelopment(): boolean {
  return useContext(DesignSystemEnvironmentContext).isDevelopment;
}
