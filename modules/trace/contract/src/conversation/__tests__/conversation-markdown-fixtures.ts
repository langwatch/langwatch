import type { ConversationTurnSource, ParsedTurn } from "../parsed-turns.ts";

export function makeTurn(opts: {
  output: string;
  assistantText: string;
  userText?: string;
  traceId?: string;
  timestamp?: number;
}): ParsedTurn<ConversationTurnSource> {
  return {
    turn: {
      traceId: opts.traceId ?? "t1",
      timestamp: opts.timestamp ?? 1_700_000_000_000,
      durationMs: 1000,
      models: ["gpt-4o"],
      totalCost: 0.01,
      totalTokens: 100,
      input: null,
      output: opts.output,
    },
    userText: opts.userText ?? "Hello",
    assistantText: opts.assistantText,
    assistantReasoning: "",
    userMedia: [],
    assistantMedia: [],
    gapSecs: 0,
    shouldShowGap: false,
  };
}
