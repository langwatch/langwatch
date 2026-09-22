import type { ParsedTurn as SharedParsedTurn } from "~/shared/traces/conversation/parsedTurns";
import type { TraceListItem } from "../../../types/trace";

export type Mode = "thread" | "bubbles" | "markdown";

/** Chat-turn presentation: ChatGPT-style full-width thread vs side bubbles. */
export type TurnLayout = "thread" | "bubbles";

/**
 * A parsed turn as the drawer holds one: the shared parse bound to the trace
 * list item the rows render from. The rows read far more of the turn than the
 * parse itself does (status, evaluations, annotations), so the binding lives
 * here rather than in the shared module.
 */
export type ParsedTurn = SharedParsedTurn<TraceListItem>;

export const EMPTY_TURNS: TraceListItem[] = [];
