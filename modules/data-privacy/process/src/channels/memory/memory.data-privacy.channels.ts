import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";

import type { DataPrivacyChannels } from "../data-privacy.channels.ts";
import { MemoryGoogleDlpChannel } from "./memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "./memory.presidio.channel.ts";

/** Detections are recorded and answered from scripted queues; nothing leaves the process. */
export class MemoryDataPrivacyChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: DataPrivacyServerConfig }): DataPrivacyChannels {
    return {
      presidio: MemoryPresidioChannel.create({ endpoint: config.langevalsEndpoint }),
      dlp: MemoryGoogleDlpChannel.create(),
    };
  }
}
