// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripeCustomersChannel } from "./http/http.stripe-customers.channel.ts";
import { MemoryStripeCustomersChannel } from "./memory/memory.stripe-customers.channel.ts";

export const stripeCustomersChannels = {
  http: HttpStripeCustomersChannel,
  memory: MemoryStripeCustomersChannel,
};
