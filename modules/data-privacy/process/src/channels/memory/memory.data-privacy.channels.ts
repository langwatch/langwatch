import { ApiKeyApi } from "@langwatch/api-key-contract";
import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import type { BoundApis } from "@langwatch/process";

import type { DataPrivacyChannels } from "../data-privacy.channels.ts";
import { MemoryGoogleDlpChannel } from "./memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "./memory.presidio.channel.ts";

/** Detections are recorded and answered from scripted queues; nothing leaves the process. */
export class MemoryDataPrivacyChannels {
  static readonly requires = [] as const;
  static readonly binds = { apiKeys: ApiKeyApi } as const;

  static create({
    config,
    bound,
  }: {
    config: DataPrivacyServerConfig;
    bound: BoundApis<typeof MemoryDataPrivacyChannels.binds>;
  }): DataPrivacyChannels {
    return {
      presidio: MemoryPresidioChannel.create({ endpoint: config.langevalsEndpoint }),
      piiRedactionModel: MemoryPresidioChannel.create({
        endpoint: config.piiRedactionModelEndpoint,
      }),
      dlp: MemoryGoogleDlpChannel.create(),
      apiKeys: bound.apiKeys,
    };
  }
}
