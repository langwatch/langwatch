/**
 * Returns whether the app is currently running in reduced-graphics mode.
 *
 * The primary mechanism for suppressing decorative blur is the
 * `data-reduced-graphics` attribute + `--lw-backdrop-blur` CSS variable set
 * by GraphicsQualityProvider (works even for static Chakra theme recipes,
 * which can't read React state). This hook exists for the rare consumer
 * that needs the signal programmatically instead of just via CSS.
 *
 * Falls back to `false` (full graphics) when no provider is mounted, same
 * fallback shape as useNow().
 */
import { createContext, useContext } from "react";

export const GraphicsQualityContext = createContext<{
  reducedGraphics: boolean;
}>({ reducedGraphics: false });

export function useGraphicsQuality(): { reducedGraphics: boolean } {
  return useContext(GraphicsQualityContext);
}
