import { MemoryTraceLegacySpoolChannel } from "./memory/memory.trace-legacy-spool.channel.ts";
import { S3TraceLegacySpoolChannel } from "./s3/s3.trace-legacy-spool.channel.ts";

/** The two tiers behind `TraceLegacySpool`. */
export const traceLegacySpoolChannels = {
  live: S3TraceLegacySpoolChannel,
  memory: MemoryTraceLegacySpoolChannel,
};
