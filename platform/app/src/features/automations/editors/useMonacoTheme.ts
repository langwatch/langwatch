import { useColorMode } from "~/components/ui/color-mode";

/**
 * Returns the Monaco theme name matching the app's current colour mode —
 * the built-in `vs-dark` in dark mode, the built-in `vs` in light. Editors
 * call this so they stop being a black box against a white page when the
 * user is in light mode.
 */
export function useMonacoTheme(): "vs-dark" | "vs" {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? "vs-dark" : "vs";
}
