import type { LangyStreamEntry } from "@langwatch/langy-contract";
import { LANGY_EMPTY_TURN_FALLBACK } from "../../rules/langy-empty-turn.rules.ts";
import {
  type LangyStreamRead,
  LangyTokenBuffer,
} from "../langy-token-buffer.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** How long a turn may go without a heartbeat before a follow gives up. */
const LIVENESS_WINDOW_MS = 30_000;

/**
 * The live edge for a process without Redis: the same ordered, replayable
 * stream, held in the shared memory store so a follow reads what an append
 * wrote.
 */
export class LangyTokenBufferMemoryRepository extends LangyTokenBuffer {
  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  static create(store: LangyMemoryStore): LangyTokenBufferMemoryRepository {
    return new LangyTokenBufferMemoryRepository(store);
  }

  async readTail(input: {
    conversationId: string;
    turnId: string;
  }): Promise<{ reads: LangyStreamRead[]; lastId: string }> {
    const reads = this.entries(input);
    return { reads: [...reads], lastId: reads.at(-1)?.id ?? "0-0" };
  }

  async *follow(input: {
    conversationId: string;
    turnId: string;
    fromId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<LangyStreamRead, void, void> {
    const key = this.store.turnKey(input);
    let cursor = Number(input.fromId.split("-")[0] ?? 0);
    while (!input.signal?.aborted) {
      const pending = this.entries(input).filter((read) => Number(read.id.split("-")[0]) > cursor);
      for (const read of pending) {
        cursor = Number(read.id.split("-")[0]);
        yield read;
      }
      if (this.store.endedStreams.has(key)) return;
      const beat = this.store.heartbeats.get(key);
      if (beat !== undefined && Date.now() - beat > LIVENESS_WINDOW_MS) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async markEnd(input: {
    conversationId: string;
    turnId: string;
    backstopSilentTurn?: boolean;
  }): Promise<{ backstopped: boolean; text?: string }> {
    const key = this.store.turnKey(input);
    const silent = this.entries(input).every((read) => read.entry.type !== "delta");
    this.store.endedStreams.add(key);
    if (!input.backstopSilentTurn || !silent) return { backstopped: false };
    this.append(input, { type: "delta", text: LANGY_EMPTY_TURN_FALLBACK });
    this.append(input, { type: "end" });
    return { backstopped: true, text: LANGY_EMPTY_TURN_FALLBACK };
  }

  async appendLocalPermission(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_permission" }>, "type">;
  }): Promise<void> {
    this.append(input, { type: "local_permission", ...input.entry });
  }

  async appendQuestion(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "question" }>, "type">;
  }): Promise<void> {
    this.append(input, { type: "question", ...input.entry });
  }

  async appendLocalWorkspace(input: {
    conversationId: string;
    turnId: string;
    entry: Omit<Extract<LangyStreamEntry, { type: "local_workspace" }>, "type">;
  }): Promise<void> {
    this.append(input, { type: "local_workspace", ...input.entry });
  }

  async appendUiAction(input: {
    conversationId: string;
    turnId: string;
    actionId: string;
    kind: string;
    payload: unknown;
  }): Promise<void> {
    this.append(input, {
      type: "ui",
      actionId: input.actionId,
      kind: input.kind,
      payload: input.payload,
    });
  }

  async appendStatus(input: {
    conversationId: string;
    turnId: string;
    status: string;
  }): Promise<void> {
    this.append(input, { type: "status", status: input.status });
  }

  async heartbeat(input: {
    conversationId: string;
    turnId: string;
    now?: number;
  }): Promise<void> {
    this.store.heartbeats.set(this.store.turnKey(input), input.now ?? Date.now());
  }

  private entries(input: { conversationId: string; turnId: string }): LangyStreamRead[] {
    return this.store.streams.get(this.store.turnKey(input)) ?? [];
  }

  private append(
    input: { conversationId: string; turnId: string },
    entry: LangyStreamEntry,
  ): void {
    const key = this.store.turnKey(input);
    const held = this.store.streams.get(key) ?? [];
    held.push({ id: `${held.length + 1}-0`, entry });
    this.store.streams.set(key, held);
  }
}
