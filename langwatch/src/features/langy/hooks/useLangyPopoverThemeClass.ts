import { useColorMode } from "~/components/ui/color-mode";
import { useLangyStore } from "../stores/langyStore";

/**
 * The colour-mode class to force on a floating-panel popover so it matches the
 * surface it lands on.
 *
 * Under the Split effect, opening a popover slides the panel to a UNIFORM
 * inverted tone behind it (see LangyWave's `park`) — white on a dark app theme,
 * dark on a light one. A menu / combobox portal'd over that surface must wear
 * the OPPOSITE colour mode, or a dark dropdown drops onto white (and vice
 * versa). Chakra v3's own nested-theme mechanism is the `chakra-theme <mode>`
 * class — exactly what `<LightMode>` / `<DarkMode>` render — so we put it on the
 * portaled content element (Menu.Content / Combobox.Content).
 *
 * Returns undefined off the Split effect: the popover inherits the app theme as
 * normal.
 */
export function useLangyPopoverThemeClass(): string | undefined {
  const panelEffect = useLangyStore((s) => s.panelEffect);
  const { colorMode } = useColorMode();
  if (panelEffect !== "split") return undefined;
  return colorMode === "dark" ? "chakra-theme light" : "chakra-theme dark";
}
