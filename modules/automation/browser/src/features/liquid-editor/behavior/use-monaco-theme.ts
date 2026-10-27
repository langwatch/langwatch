import { useColorMode } from "@langwatch/design-system/color-mode";

/**
 * Returns the Monaco theme name matching the current colour mode — the
 * built-in `vs-dark` in dark mode, `vs` in light mode.
 */
export function useMonacoTheme(): "vs-dark" | "vs" {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? "vs-dark" : "vs";
}
