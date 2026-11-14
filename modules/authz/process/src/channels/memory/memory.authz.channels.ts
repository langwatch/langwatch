import type { AuthzChannels } from "../authz.channels.ts";
import { MemoryReleaseFlagsChannel } from "./memory.release-flags.channel.ts";

/** The memory tier answers flags itself, so a test releases a flag rather than standing one up. */
export class MemoryAuthzChannels {
  static readonly requires = [] as const;

  static create(): AuthzChannels & { readonly flags: MemoryReleaseFlagsChannel } {
    return { flags: MemoryReleaseFlagsChannel.create() };
  }
}
