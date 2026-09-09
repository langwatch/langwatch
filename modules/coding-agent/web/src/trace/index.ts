export { AnsiText } from "./terminal-ansi-text.tsx";
export * from "./context-health.ts";
export * from "./terminal-ansi-parser.ts";
export { TerminalDiff } from "./terminal-diff.tsx";
export * from "./terminal-line-diff.ts";
export { TerminalOutput } from "./terminal-output.tsx";
// The screen's own colours. Exported because a host renders the terminal's
// empty and loading states beside it and has to paint the same background;
// without it the placeholder sat on the page's colour inside a black screen.
export { TERMINAL_TOKENS } from "./terminal-palette.ts";
export { TerminalPatch } from "./terminal-patch.tsx";
export { TerminalSkeleton } from "./terminal-skeleton.tsx";
export { deriveSessionBanner } from "./terminal-session-banner.ts";
export type { SessionBanner } from "./terminal-session-banner.ts";
export { CONVERSATION_TURN_CAP, mergeSessionTurns } from "./terminal-session-scrollback.ts";
export type {
  EarlierTotals,
  LoadedTurn,
  ScrollbackStatus,
  TurnDivider,
} from "./terminal-session-scrollback.ts";
export {
  buildEntryTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  toolPrimaryArg,
} from "./terminal-session.ts";
export { indexToolSpansBySpanId, parsePatchHunks } from "./terminal-tool-spans.ts";
export type { PatchHunk, TerminalToolSpan } from "./terminal-tool-spans.ts";
export { TerminalView, statusLineCostLabel } from "./terminal-view.tsx";
export { deriveTokenTimeline, findCacheRebuilds } from "./token-timeline.ts";
export type { CacheRebuildEvent, TokenTimelinePoint } from "./token-timeline.ts";
export { toolResultBodyToString } from "./tool-result-body.ts";
export { SessionView } from "./session-view.tsx";
export { deriveSessionSignals, formatCompact, formatShortDuration } from "./session-signals.ts";
export type { CodingAgentSessionDisplay } from "./session-display.ts";
