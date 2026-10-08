// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SaasChannels } from "../saas.channels.ts";
import { MemoryProductAnalyticsChannel } from "./memory.product-analytics.channel.ts";

/** Product analytics is held in-process, so a memory install sends nothing over the network. */
export class MemorySaasChannels {
  static readonly requires = [] as const;

  static create(): SaasChannels {
    return { analytics: MemoryProductAnalyticsChannel.create() };
  }
}
