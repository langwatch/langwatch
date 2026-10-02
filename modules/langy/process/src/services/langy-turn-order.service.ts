/**
 * The order a turn actually happened in, read off its own live stream. A turn is a sequence: a
 * paragraph, a call, another paragraph, another call.
 */
import type { LangyFinalToolCall, LangyStreamEntry } from "@langwatch/langy-contract";

/** One thing the turn did, in the order it did it. */
export type LangyTurnSegment = { kind: "text"; text: string } | { kind: "tool"; id: string };

/**
 * What a turn put on its stream that the record keeps: its ordered account, the calls that
 * returned, and the paragraph it ended on. A failed turn hands over nothing else, so this is the
 * only account of the plan it wrote and the calls it ran.
 */
export type LangyTurnAccount = {
  order: LangyTurnSegment[];
  toolCalls: LangyFinalToolCall[];
  /** The paragraph the turn ended on, or "" when it ended on a call. */
  closingText: string;
};

type ToolStreamEntry = Extract<LangyStreamEntry, { type: "tool" }>;
type ToolCallInProgress = LangyFinalToolCall & { returned: boolean };

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

  async readTurnAccount(at: { conversationId: string; turnId: string }): Promise<LangyTurnAccount> {
    const { reads } = await this.buffer.readTail(at);

    return LangyTurnOrderService.turnAccountFromStream(reads.map(({ entry }) => entry));
  }

  /**
   * Fold a turn's stream entries into its account. A call is kept once it returned: its `start`
   * carries the name and input, its `end` the result. A call still running when the turn ended
   * has no result to show and is left out.
   */
  static turnAccountFromStream(entries: readonly LangyStreamEntry[]): LangyTurnAccount {
    const order = LangyTurnOrderService.turnOrderFromStream(entries);
    const calls = new Map<string, ToolCallInProgress>();
    for (const entry of entries) {
      if (entry.type !== "tool") {
        continue;
      }

      calls.set(entry.id, LangyTurnOrderService.withToolEntry(calls.get(entry.id), entry));
    }

    const toolCalls = [...calls.values()]
      .filter((call) => call.returned)
      .map(({ returned: _returned, ...call }) => call);
    const last = order.at(-1);

    return { order, toolCalls, closingText: last?.kind === "text" ? last.text : "" };
  }

  /** A call, with one more of its stream entries applied. */
  private static withToolEntry(
    call: ToolCallInProgress | undefined,
    entry: ToolStreamEntry,
  ): ToolCallInProgress {
    const next: ToolCallInProgress = call
      ? { ...call }
      : { id: entry.id, name: entry.name, returned: false };
    if (entry.name) {
      next.name = entry.name;
    }

    if (entry.input !== undefined) {
      next.input = entry.input;
    }

    if (entry.local === true) {
      next.local = true;
    }

    if (entry.phase !== "end") {
      return next;
    }

    return {
      ...next,
      returned: true,
      ...(entry.output !== undefined ? { output: entry.output } : {}),
      ...(entry.isError !== undefined ? { isError: entry.isError } : {}),
      ...(entry.digest !== undefined ? { digest: entry.digest } : {}),
      ...(entry.result !== undefined ? { result: entry.result } : {}),
    };
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
  /** The whole account, for a turn that failed before handing one over. */
  readTurnAccount?(a: { conversationId: string; turnId: string }): Promise<LangyTurnAccount>;
}
