/**
 * The search palette: owns a catalogue and ranking over other families' own
 * queries. Separate entry from `./chrome` so it isn't in every sidebar's graph.
 */

export { CommandBarProvider } from "../../ui/sections/command-bar-provider.tsx";
export { CommandBarTrigger } from "../../ui/sections/command-bar-trigger.tsx";
export { CommandPalette, type CommandPaletteSurface } from "../../ui/sections/command-palette.tsx";
export { useCommandBar } from "../../behavior/command-bar-context.ts";
export { openCommandBar, hasCommandBar } from "../../behavior/command-bar-control.ts";
export { getCommandBarShortcut, getIsMac } from "../../model/command-platform.ts";
export { featureIcons, recentItemTypeToFeature, type FeatureKey } from "../../model/feature-icons.ts";
