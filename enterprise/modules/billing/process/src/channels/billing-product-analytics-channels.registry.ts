// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HttpBillingProductAnalyticsChannel } from "./http/http.billing-product-analytics.channel.ts";
import { MemoryBillingProductAnalyticsChannel } from "./memory/memory.billing-product-analytics.channel.ts";

export const billingProductAnalyticsChannels = {
  live: HttpBillingProductAnalyticsChannel,
  memory: MemoryBillingProductAnalyticsChannel,
};
