import type { TraceTokenCounter } from "./token-counter.channel.ts";
import type { TraceLegacySpool } from "./trace-legacy-spool.channel.ts";

/** Every channel trace holds, as the container hands them to the module class. */
export interface TraceChannels {
  readonly tokenizer: TraceTokenCounter;
  readonly legacySpool: TraceLegacySpool;
}
