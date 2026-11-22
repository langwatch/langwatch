/**
 * The search palette: owns a catalogue and ranking over other families' own
 * queries. Separate entry from `./chrome` so it isn't in every sidebar's graph.
 */

export { CommandBarProvider } from "./features/command-bar/ui/sections/command-bar-provider.tsx";
export { CommandBarTrigger } from "./features/command-bar/ui/sections/command-bar-trigger.tsx";
export {
  CommandPalette,
  type CommandPaletteSurface,
} from "./features/command-bar/ui/sections/command-palette.tsx";
export { useCommandBar } from "./features/command-bar/behavior/command-bar-context.ts";
export {
  openCommandBar,
  hasCommandBar,
} from "./features/command-bar/behavior/command-bar-control.ts";
export { getCommandBarShortcut, getIsMac } from "./features/command-bar/model/command-platform.ts";
export { featureIcons, recentItemTypeToFeature, type FeatureKey } from "./model/feature-icons.ts";
