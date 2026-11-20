// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestChannels } from "../digest.channels.ts";
import { MemoryDigestMailChannel } from "./memory.digest-mail.channel.ts";

/** Every weekly email recorded in-process instead of sent. */
export class MemoryDigestChannels {
  static readonly requires = [] as const;

  static create(): DigestChannels {
    return { mail: MemoryDigestMailChannel.create() };
  }
}
