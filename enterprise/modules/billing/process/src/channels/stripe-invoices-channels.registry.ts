// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpStripeInvoicesChannel } from "./http/http.stripe-invoices.channel.ts";
import { MemoryStripeInvoicesChannel } from "./memory/memory.stripe-invoices.channel.ts";

export const stripeInvoicesChannels = {
  http: HttpStripeInvoicesChannel,
  memory: MemoryStripeInvoicesChannel,
};
