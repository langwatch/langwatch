import { useColorMode } from "~/components/ui/color-mode";

/**
 * Returns the Monaco theme name matching the app's current colour mode —
 * `monokai` in dark mode, the built-in `vs` in light. Editors call this so
 * they stop being a black box against a white page when the user is in light
 * mode.
 */
export function useMonacoTheme(): "monokai" | "vs" {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? "monokai" : "vs";
}
