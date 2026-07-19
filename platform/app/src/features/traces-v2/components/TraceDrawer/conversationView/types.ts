import type { TraceListItem } from "../../../types/trace";

export type Mode = "thread" | "bubbles" | "markdown" | "annotations";

/** Chat-turn presentation: ChatGPT-style full-width thread vs side bubbles. */
export type TurnLayout = "thread" | "bubbles";

export interface ParsedTurn {
  turn: TraceListItem;
  userText: string;
  /**
   * Pre-extracted assistant prose for the bubble. Strips Anthropic-style
   * `{role:"assistant",content:[{type:"thinking"…},…]}` envelopes and
   * pulls just the text blocks, so we don't dump raw JSON in the bubble.
   */
  assistantText: string;
  assistantReasoning: string;
  gapSecs: number;
  showGap: boolean;
}

export const EMPTY_TURNS: TraceListItem[] = [];
