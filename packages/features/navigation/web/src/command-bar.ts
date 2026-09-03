/**
 * THE SEARCH PALETTE, and the reason it is in this package rather than one of
 * its own.
 *
 * It owns no procedure. The five lists it searches are other families' own
 * queries, asked at their own paths and inputs so the answers are their cache
 * entries — the way the sidebar's usage meter shares one entry with the plan
 * read. What the palette owns is a catalogue and a ranking, and what it IS, to
 * a reader, is the shell's Quick Search row and the header's trigger. So it
 * lives with the shell that draws it, and everything it cannot name from here —
 * the drawers its actions open, the assistant its hand-off reaches, the chat
 * bubble its support entry opens — it asks the host port for.
 *
 * A SEPARATE ENTRY FROM `./chrome`, and that is load-bearing rather than
 * tidiness. The shell renders the trigger as a NODE the host hands it, so
 * nothing in `./chrome` reaches the palette; publishing them together would
 * have put the 719-line catalogue, five queries and the results list into the
 * module graph of every surface that draws a sidebar. The two entries are what
 * keeps the shell's cost the shell's.
 */

export { CommandBarProvider } from "./ui/sections/command-bar-provider";
export { CommandBarTrigger } from "./ui/sections/command-bar-trigger";
export { CommandPalette, type CommandPaletteSurface } from "./ui/sections/command-palette";
export { useCommandBar } from "./behavior/command-bar-context";
export { openCommandBar, hasCommandBar } from "./behavior/command-bar-control";
export { getCommandBarShortcut, getIsMac } from "./model/command-platform";
export { featureIcons, recentItemTypeToFeature, type FeatureKey } from "./model/feature-icons";
