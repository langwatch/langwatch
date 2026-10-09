// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripeWebhooksChannel } from "./http/http.stripe-webhooks.channel.ts";
import { MemoryStripeWebhooksChannel } from "./memory/memory.stripe-webhooks.channel.ts";

export const stripeWebhooksChannels = {
  http: HttpStripeWebhooksChannel,
  memory: MemoryStripeWebhooksChannel,
};
