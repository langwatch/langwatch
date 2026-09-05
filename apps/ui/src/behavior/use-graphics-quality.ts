/**
 * Whether the app is in reduced-graphics mode, for a consumer that needs
 * the signal in JS. Falls back to `false` when no provider is mounted.
 */
import { createContext, useContext } from "react";

export const GraphicsQualityContext = createContext<{ reducedGraphics: boolean }>({
  reducedGraphics: false,
});

export function useGraphicsQuality(): { reducedGraphics: boolean } {
  return useContext(GraphicsQualityContext);
}
