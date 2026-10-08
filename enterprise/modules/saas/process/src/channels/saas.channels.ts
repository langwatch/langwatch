// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProductAnalyticsChannel } from "./product-analytics.channel.ts";

/** Every channel saas holds, as the container hands them to the module class. */
export interface SaasChannels {
  readonly analytics: ProductAnalyticsChannel;
}
