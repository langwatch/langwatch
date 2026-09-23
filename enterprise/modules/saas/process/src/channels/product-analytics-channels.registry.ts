// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HttpProductAnalyticsChannel } from "./http/http.product-analytics.channel.ts";
import { MemoryProductAnalyticsChannel } from "./memory/memory.product-analytics.channel.ts";

/** The two tiers behind `ProductAnalyticsChannel`. */
export const productAnalyticsChannels = {
  live: HttpProductAnalyticsChannel,
  memory: MemoryProductAnalyticsChannel,
};
