// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripeMetersChannel } from "./http/http.stripe-meters.channel.ts";
import { MemoryStripeMetersChannel } from "./memory/memory.stripe-meters.channel.ts";

export const stripeMetersChannels = {
  http: HttpStripeMetersChannel,
  memory: MemoryStripeMetersChannel,
};
