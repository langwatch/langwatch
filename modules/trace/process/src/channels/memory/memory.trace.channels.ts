import type { TraceChannels } from "../trace.channels.ts";
import { MemoryTokenCounterChannel } from "./memory.token-counter.channel.ts";
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
