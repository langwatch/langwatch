import type { CollectorTrace, TraceCollectorChannel } from "../trace-collector.channel.ts";

/** The collector in memory: every post is kept; `unreachable` makes the next post throw. */
export class MemoryTraceCollectorChannel implements TraceCollectorChannel {
  readonly posts: { authToken: string; trace: CollectorTrace }[] = [];
  unreachable = false;

  private constructor() {}

  static create(): MemoryTraceCollectorChannel {
    return new MemoryTraceCollectorChannel();
  }

  async post(input: { authToken: string; trace: CollectorTrace }): Promise<void> {
    if (this.unreachable) throw new Error("connect ECONNREFUSED /api/collector");
    this.posts.push(input);
  }
}
