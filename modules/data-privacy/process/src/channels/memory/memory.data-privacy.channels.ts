import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";

import { splitModelTargetOf } from "../../rules/pii-redaction-split.rules.ts";
import type { DataPrivacyChannels } from "../data-privacy.channels.ts";
import { MemoryGoogleDlpChannel } from "./memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "./memory.presidio.channel.ts";

/** Detections are recorded and answered from scripted queues; nothing leaves the process. */
export class MemoryDataPrivacyChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: DataPrivacyServerConfig }): DataPrivacyChannels {
    // As the live channel: only a Lambda function ARN configures the split model.
    const split = splitModelTargetOf(config.piiRedactionModelSplitEndpoint);
    return {
      presidio: MemoryPresidioChannel.create({ endpoint: config.langevalsEndpoint }),
      piiRedactionModel: MemoryPresidioChannel.create({
        endpoint: config.piiRedactionModelEndpoint,
      }),
      piiRedactionModelSplit: MemoryPresidioChannel.create({
        endpoint: split.kind === "lambda" ? split.functionArn : undefined,
      }),
      dlp: MemoryGoogleDlpChannel.create(),
    };
  }
}
