/**
 * The verbs the activity row cycles while Langy is working between steps.
 *
 * They render standalone (`${verb}…`), one word each, and only ever while the
 * model is genuinely working: the row that shows them is derived from what is
 * on the wire (`logic/langyThinkingLine.ts`), so a turn whose worker never
 * started shows the startup ladder instead and never cycles.
 *
 * "Thinking" is the default state of mind and shows more often than the rest,
 * so the list carries it several times. No two neighbours repeat, because the
 * row crossfades on the text and a repeat would freeze the crossfade.
 */
export const LANGY_THINKING_VERBS = [
  "Thinking",
  "Crunching",
  "Thinking",
  "Analyzing",
  "Thinking",
  "Langying",
  "Pondering",
  "Thinking",
  "Wiring",
  "Checking",
] as const;
