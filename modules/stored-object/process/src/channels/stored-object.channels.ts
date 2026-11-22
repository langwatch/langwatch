import type { ExternalImageChannel } from "./external-image.channel.ts";

/** Every channel stored-object holds, as the container hands them to the module class. */
export interface StoredObjectChannels {
  readonly images: ExternalImageChannel;
}
