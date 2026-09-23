export { AnsiText } from "./ui/elements/trace/terminal-ansi-text.tsx";
export * from "./model/trace/context-health.ts";
export * from "./model/trace/terminal-ansi-parser.ts";
export { TerminalDiff } from "./ui/elements/trace/terminal-diff.tsx";
export * from "./model/trace/terminal-line-diff.ts";
export { TerminalOutput } from "./ui/elements/trace/terminal-output.tsx";
// The screen's own colours. Exported because a host renders the terminal's
// empty and loading states beside it and has to paint the same background;
// without it the placeholder sat on the page's colour inside a black screen.
export { TERMINAL_TOKENS } from "./model/trace/terminal-palette.ts";
export { TerminalPatch } from "./ui/elements/trace/terminal-patch.tsx";
export { TerminalSkeleton } from "./ui/elements/trace/terminal-skeleton.tsx";
export { deriveSessionBanner } from "./model/trace/terminal-session-banner.ts";
export type { SessionBanner } from "./model/trace/terminal-session-banner.ts";
export {
  CONVERSATION_TURN_CAP,
  mergeSessionTurns,
} from "./model/trace/terminal-session-scrollback.ts";
export type {
  EarlierTotals,
  LoadedTurn,
  ScrollbackStatus,
  TurnDivider,
} from "./model/trace/terminal-session-scrollback.ts";
export {
  buildEntryTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  toolPrimaryArg,
} from "./model/trace/terminal-session.ts";
export { indexToolSpansBySpanId, parsePatchHunks } from "./model/trace/terminal-tool-spans.ts";
export type { PatchHunk, TerminalToolSpan } from "./model/trace/terminal-tool-spans.ts";
export { TerminalView, statusLineCostLabel } from "./ui/elements/trace/terminal-view.tsx";
export { deriveTokenTimeline, findCacheRebuilds } from "./model/trace/token-timeline.ts";
export type { CacheRebuildEvent, TokenTimelinePoint } from "./model/trace/token-timeline.ts";
export { toolResultBodyToString } from "./model/trace/tool-result-body.ts";
export { SessionView } from "./ui/elements/trace/session-view.tsx";
export {
  deriveSessionSignals,
  formatCompact,
  formatShortDuration,
} from "./model/trace/session-signals.ts";
export type { CodingAgentSessionDisplay } from "./model/trace/session-display.ts";

export * from "./ui/elements/agent-label.tsx";
export * from "./model/assistant-identity.ts";
export * from "./model/assistant-presets.ts";

export * from "./model/duration.ts";
export * from "./model/short-date.ts";
export * from "./ui/elements/detail-section.tsx";
export * from "./ui/elements/peer-comparison-cell.tsx";
export * from "./model/percentile.ts";
export * from "./ui/elements/models-section.tsx";
export type { DetailPayload } from "./model/pull-request-detail.ts";
export { MISSING_VALUE, MissingValue } from "./ui/elements/cells/missing-value.tsx";
