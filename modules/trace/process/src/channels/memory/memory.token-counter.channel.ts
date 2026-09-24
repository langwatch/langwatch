import type { TraceTokenCounter } from "../token-counter.channel.ts";

/** Records every count asked for and answers "cannot count", as a deployment
 * without encoding tables does. */
export class MemoryTokenCounterChannel implements TraceTokenCounter {
  static create(): MemoryTokenCounterChannel {
    return new MemoryTokenCounterChannel();
  }

  readonly requests: { model: string; text: string | undefined }[] = [];
  closed = false;

  private constructor() {}

  async computeTokenCount(model: string, text: string | undefined): Promise<number | undefined> {
    this.requests.push({ model, text });
    return undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
