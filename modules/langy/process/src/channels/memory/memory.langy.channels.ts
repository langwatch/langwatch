import type { LangyChannels } from "../langy.channels.ts";
import { MemoryLangyWorkerChannel } from "./memory.langy-worker.channel.ts";

/** The worker manager is answered in-process, with the outcome a test scripts. */
export class MemoryLangyChannels {
  static readonly requires = [] as const;

  static create(): LangyChannels {
    return { worker: MemoryLangyWorkerChannel.create() };
  }
}
