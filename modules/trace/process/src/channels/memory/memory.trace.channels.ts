import type { TraceTokenCounter } from "../token-counter.channel.ts";
import type { TraceChannels } from "../trace.channels.ts";
import { MemoryTraceLegacySpoolChannel } from "./memory.trace-legacy-spool.channel.ts";

/** Token counts and v1 spool reads are answered in-process for a test to script. */
export class MemoryTraceChannels {
  static readonly requires = [] as const;

  static create(): TraceChannels {
    return {
      tokenizer: MemoryTokenCounterChannel.create(),
      legacySpool: MemoryTraceLegacySpoolChannel.create(),
    };
  }
}

/** Records every count asked for and answers "cannot count", as a deployment
 * without encoding tables does. */
class MemoryTokenCounterChannel implements TraceTokenCounter {
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
