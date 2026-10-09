import type { SubsystemProbeChannel } from "./subsystem-probe.channel.ts";

/** Every channel platform-health holds, as the container hands them to the module class. */
export interface PlatformHealthChannels {
  readonly canaries: SubsystemProbeChannel;
}
