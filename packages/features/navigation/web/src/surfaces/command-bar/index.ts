/**
 * The search palette: owns a catalogue and ranking over other families' own
 * queries. Separate entry from `./chrome` so it isn't in every sidebar's graph.
 */

export { CommandBarProvider } from "../../ui/sections/command-bar-provider";
export { CommandBarTrigger } from "../../ui/sections/command-bar-trigger";
export { CommandPalette, type CommandPaletteSurface } from "../../ui/sections/command-palette";
export { useCommandBar } from "../../behavior/command-bar-context";
export { openCommandBar, hasCommandBar } from "../../behavior/command-bar-control";
export { getCommandBarShortcut, getIsMac } from "../../model/command-platform";
export { featureIcons, recentItemTypeToFeature, type FeatureKey } from "../../model/feature-icons";
