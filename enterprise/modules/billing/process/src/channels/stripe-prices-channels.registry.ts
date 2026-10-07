// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripePricesChannel } from "./http/http.stripe-prices.channel.ts";
import { MemoryStripePricesChannel } from "./memory/memory.stripe-prices.channel.ts";

export const stripePricesChannels = {
  http: HttpStripePricesChannel,
  memory: MemoryStripePricesChannel,
};
