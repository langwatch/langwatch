import type { ApiKeyChannels } from "../api-key.channels.ts";
import { MemoryReleaseFlagsChannel } from "./memory.release-flags.channel.ts";

/** The memory tier answers flags itself, so a test releases a flag rather than standing one up. */
export class MemoryApiKeyChannels {
  static readonly requires = [] as const;

  static create(): ApiKeyChannels & { readonly flags: MemoryReleaseFlagsChannel } {
    return { flags: MemoryReleaseFlagsChannel.create() };
  }
}
