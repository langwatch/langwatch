import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyStreamEntry } from "./langyTokenBuffer";

/**
 * Decide whether to synthesize a terminal stream entry for a turn whose live
 * terminal frame the durable buffer never received.
 *
 * `onTurnStream` tails the token buffer; when a refresh mid-turn misses the
 * worker's terminal frame (its relay connection dropped before it), the buffer
 * has no `end`/`error` and `follow()` would block until the hard per-turn
 * deadline — leaving the UI on "Starting up…" for minutes though the turn already
 * finished server-side.
 *
 * We synthesize a terminal ONLY when BOTH hold, so a live or still-starting turn
 * is never cut off:
 *   - the per-turn heartbeat is STALE — a running turn keeps a fresh one; AND
 *   - the durable fold says the turn is no longer in flight. Its status flips to
 *     ACTIVE/RUNNING at `agent_turn_accepted`, BEFORE any output, so even a cold
 *     start (which streams nothing for its first ~10-20s) reads as in-flight, not
 *     settled.
 *
 * FAILED → `error` (carrying lastError); IDLE (completed) → `end`. Any other or
 * transitional status — including ARCHIVED and anything added later — yields
 * null (stay patient; never guess a terminal).
 *
 * `status` is deliberately `string`, not the `LANGY_CONVERSATION_STATUS` union:
 * it arrives from the conversation projection's bare string column
 * (`getById(): { status: string }`), so narrowing here would only buy a cast at
 * the call site that asserts something the data does not guarantee. Typo safety
 * is already structural — every comparison below is against the exported
 * constant, so a renamed or removed status fails to compile here, and an
 * unrecognised value falls through to the safe `null`.
 */
export function decideSyntheticTerminal({
  status,
  lastError,
  heartbeatStale,
}: {
  status: string;
  lastError: string | null;
  heartbeatStale: boolean;
}): LangyStreamEntry | null {
  // A live turn keeps a fresh heartbeat — never synthesize over one.
  if (!heartbeatStale) return null;

  if (
    status === LANGY_CONVERSATION_STATUS.ACTIVE ||
    status === LANGY_CONVERSATION_STATUS.RUNNING
  ) {
    return null;
  }
  if (status === LANGY_CONVERSATION_STATUS.FAILED) {
    return { type: "error", error: lastError ?? "Turn failed" };
  }
  if (status === LANGY_CONVERSATION_STATUS.IDLE) {
    return { type: "end" };
  }
  return null;
}
