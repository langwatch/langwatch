/**
 * One trace in a conversation, as the session strip and the trace drawer read it.
 */

import type { DerivedTraceStatus } from "@langwatch/trace-contract";

export interface ConversationTurn {
  traceId: string;
  timestamp: number;
  name: string;
  rootSpanType: string | null;
  status: DerivedTraceStatus;
  input: string | null;
  output: string | null;
  /**
   * Set when a restrict privacy rule hid the turn's content from this viewer
   * (the server nulled `input`/`output`). Lets the strip render a "Redacted"
   * marker instead of a "(no message)" placeholder that reads as truly absent.
   */
  inputRedacted?: boolean | null;
  outputRedacted?: boolean | null;
  inputVisibleTo?: string | null;
  outputVisibleTo?: string | null;
  /**
   * The turn's own totals, so the terminal view can count the session's turns above its
   * loaded window without reading their transcripts. Optional because a cached response
   * from before the fields existed may not carry them.
   */
  totalTokens?: number | null;
  totalCost?: number | null;
}
