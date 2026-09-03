/**
 * The order a turn actually happened in, read off its own live stream.
 *
 * A turn is a sequence: a paragraph, a call, another paragraph, another call.
 * The durable record used to keep none of that — every call first, then the
 * text the agent wrote after its LAST call — so a reader who refreshed got a
 * pile of cards and one closing paragraph, and the account of what happened in
 * between was gone. The agent was even told to hoard its text to the end
 * because of it.
 *
 * The stream already carries the true order: `delta` entries for the prose and
 * `tool` entries for the calls, in arrival order. This folds that into the
 * compact account `buildFinalAssistantParts` records:
 *
 *   - consecutive deltas become ONE text segment (the paragraph between calls);
 *   - a call is placed where it STARTED, which is where its card belongs and
 *     where the live panel already draws it. A result that lands after the
 *     agent has written more text does not move the card down past that text.
 *
 * Everything else on the stream — status, progress, reasoning, plan, navigate,
 * ui — is live-only signal and holds no place in the record.
 */
import type { LangyStreamEntry } from "./langy-token-buffer";

/** One thing the turn did, in the order it did it. */
export type LangyTurnSegment = { kind: "text"; text: string } | { kind: "tool"; id: string };

/**
 * Fold a turn's stream entries into its ordered account.
 *
 * A call is recorded once, at its first appearance: an `end` without a `start`
 * still takes a place (the harness may only report a completed call), but an
 * `end` that follows its own `start` does not take a second one.
 */
export function turnOrderFromStream(entries: readonly LangyStreamEntry[]): LangyTurnSegment[] {
  const order: LangyTurnSegment[] = [];
  const placed = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "delta") {
      const open = order.at(-1);
      if (open?.kind === "text") {
        open.text += entry.text;
        continue;
      }
      order.push({ kind: "text", text: entry.text });
      continue;
    }
    if (entry.type !== "tool") continue;
    if (placed.has(entry.id)) continue;
    placed.add(entry.id);
    order.push({ kind: "tool", id: entry.id });
  }

  return order;
}

/** The live edge, as the order read needs it: the whole turn, from the start. */
export interface LangyTurnStreamTail {
  readTail(a: { conversationId: string; turnId: string }): Promise<{
    reads: { entry: LangyStreamEntry }[];
  }>;
}

/**
 * Reads a turn's ordered account. Injected into the conversation service so
 * BOTH finalize paths record the same shape: the relay's terminal frame and the
 * agent's own HTTP post race each other, the ingest keeps whichever lands
 * first, and a turn's order must not depend on who won.
 */
export interface LangyTurnOrderReader {
  readTurnOrder(a: { conversationId: string; turnId: string }): Promise<LangyTurnSegment[]>;
}

export function createLangyTurnOrderReader(buffer: LangyTurnStreamTail): LangyTurnOrderReader {
  return {
    async readTurnOrder(at) {
      const { reads } = await buffer.readTail(at);
      return turnOrderFromStream(reads.map(({ entry }) => entry));
    },
  };
}
