import type { LangyChannels } from "../langy.channels.ts";
import { MemoryLangyLocalWorkspaceChannel } from "./memory.langy-local-workspace.channel.ts";
import { MemoryLangyWorkerChannel } from "./memory.langy-worker.channel.ts";

/** The worker manager answers in-process with the outcome a test scripts; nudges stay here too. */
export class MemoryLangyChannels {
  static readonly requires = [] as const;

  static create(): LangyChannels {
    return {
      worker: MemoryLangyWorkerChannel.create(),
      workspace: MemoryLangyLocalWorkspaceChannel.create(),
    };
  }
}
