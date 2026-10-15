import type { PlatformHealthChannels } from "../platform-health.channels.ts";
import { MemorySubsystemProbeChannel } from "./memory.subsystem-probe.channel.ts";

/** The canaries are recorded in-process and answered with an empty 200. */
export class MemoryPlatformHealthChannels {
  static readonly requires = [] as const;

  static create(): PlatformHealthChannels {
    return { canaries: MemorySubsystemProbeChannel.create() };
  }
}
