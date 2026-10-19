import type { StoredObjectChannels } from "../stored-object.channels.ts";
import { MemoryExternalImageChannel } from "./memory.external-image.channel.ts";

/** Outside pictures are answered in-process; an unscripted address is refused. */
export class MemoryStoredObjectChannels {
  static readonly requires = [] as const;

  static create(): StoredObjectChannels {
    return { images: MemoryExternalImageChannel.create() };
  }
}
