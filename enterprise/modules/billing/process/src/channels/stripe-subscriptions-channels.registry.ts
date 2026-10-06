// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripeSubscriptionsChannel } from "./http/http.stripe-subscriptions.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "./memory/memory.stripe-subscriptions.channel.ts";

export const stripeSubscriptionsChannels = {
  http: HttpStripeSubscriptionsChannel,
  memory: MemoryStripeSubscriptionsChannel,
};
