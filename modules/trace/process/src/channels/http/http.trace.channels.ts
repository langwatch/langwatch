import { TraceCapabilityUnavailableError, type TraceServerConfig } from "@langwatch/trace-contract";

import { S3TraceLegacySpoolChannel } from "../s3/s3.trace-legacy-spool.channel.ts";
import type { TraceChannels } from "../trace.channels.ts";
import { HttpTokenCounterChannel } from "./http.token-counter.channel.ts";

/**
 * Tokenizer files over HTTP. A v1 spool ref predates the stored-object registry and reads back
 * through S3 directly, which no process composes; `resolveOffloadedTraces` swallows the refusal.
 */
export class HttpTraceChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: TraceServerConfig }): TraceChannels {
    return {
      tokenizer: HttpTokenCounterChannel.create(config.tokenizer),
      legacySpool: S3TraceLegacySpoolChannel.create({
        resolveS3Client: () =>
          Promise.reject(
            new TraceCapabilityUnavailableError("this process", "a v1 spool object read"),
          ),
      }),
    };
  }
}
