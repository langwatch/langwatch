import type { ParsedTurn as ConversationParsedTurn } from "@langwatch/trace-contract/conversation";

import type { TraceListItem } from "../../types/trace.ts";

export type Mode = "thread" | "bubbles" | "markdown";

/** Chat-turn presentation: ChatGPT-style full-width thread vs side bubbles. */
export type TurnLayout = "thread" | "bubbles";

/** The shared conversation parse, over the rows the drawer's list already holds. */
export type ParsedTurn = ConversationParsedTurn<TraceListItem>;

export const EMPTY_TURNS: TraceListItem[] = [];
