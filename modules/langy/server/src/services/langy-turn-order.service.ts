/**
 * The order a turn actually happened in, read off its own live stream. A turn is a sequence: a
 * paragraph, a call, another paragraph, another call.
 */
import type { LangyStreamEntry } from "@langwatch/langy-contract";

/** One thing the turn did, in the order it did it. */
export type LangyTurnSegment = { kind: "text"; text: string } | { kind: "tool"; id: string };

/**
 * Fold a turn's stream entries into its ordered account. A call is recorded once, at its first
 * appearance: an `end` without a `start` still takes a place (the harness may only report a
 * completed call), but an `end` that follows its own `start` does not take a second one.
 */
export class LangyTurnOrderService implements LangyTurnOrderReader {
  static create(buffer: LangyTurnStreamTail): LangyTurnOrderService {
    return new LangyTurnOrderService(buffer);
  }

  private constructor(private readonly buffer: LangyTurnStreamTail) {}

  async readTurnOrder(at: { conversationId: string; turnId: string }): Promise<LangyTurnSegment[]> {
    const { reads } = await this.buffer.readTail(at);

    return LangyTurnOrderService.turnOrderFromStream(reads.map(({ entry }) => entry));
  }

  static turnOrderFromStream(entries: readonly LangyStreamEntry[]): LangyTurnSegment[] {
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

      if (entry.type !== "tool") {
        continue;
      }

      if (placed.has(entry.id)) {
        continue;
      }

      placed.add(entry.id);
      order.push({ kind: "tool", id: entry.id });
    }

    return order;
  }
}

/** The live edge, as the order read needs it: the whole turn, from the start. */
export interface LangyTurnStreamTail {
  readTail(a: { conversationId: string; turnId: string }): Promise<{
    reads: { entry: LangyStreamEntry }[];
  }>;
}

/**
 * Reads a turn's ordered account. Injected into the conversation service so BOTH finalize paths
 * record the same shape: the relay's terminal frame and the agent's own HTTP post race each
 * other, the ingest keeps whichever lands first, and a turn's order must not depend on who won.
 */
export interface LangyTurnOrderReader {
  readTurnOrder(a: { conversationId: string; turnId: string }): Promise<LangyTurnSegment[]>;
}
