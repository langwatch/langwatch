import { type Dispatcher, MockAgent } from "undici";

import type { NlpFetchChannel } from "../nlp-fetch.channel.ts";

/** nlpgo with the network cut: fixed deadlines, a mock dispatcher per deadline asked for. */
export class MemoryNlpFetchChannel implements NlpFetchChannel {
  static create({
    floorTimeoutMs = 630_000,
    maxTimeoutMs = 900_000,
  }: { floorTimeoutMs?: number; maxTimeoutMs?: number } = {}): MemoryNlpFetchChannel {
    return new MemoryNlpFetchChannel(floorTimeoutMs, maxTimeoutMs);
  }

  readonly requestedTimeoutsMs: number[] = [];
  closed = false;

  private constructor(
    private readonly floorMs: number,
    private readonly maxMs: number,
  ) {}

  floorTimeoutMs(): number {
    return this.floorMs;
  }

  maxTimeoutMs(): number {
    return this.maxMs;
  }

  dispatcher({ timeoutMs }: { timeoutMs: number }): Dispatcher {
    this.requestedTimeoutsMs.push(timeoutMs);
    const agent = new MockAgent();
    agent.disableNetConnect();
    return agent;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
