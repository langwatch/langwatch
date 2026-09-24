import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GatewayApp } from "../app/gateway.app.ts";
import { GATEWAY_SPEND_PIPELINE_NAME } from "./gateway-spend-commands.process.ts";

/**
 * gateway_spend, registered by the module that owns it. The webhook and debit
 * reactions arrive as subscribers once WebhookApi/GovernanceApi hold their ops (WP-6b).
 */
export const gatewaySpendEventing = defineEventingModule({
  pipeline: GATEWAY_SPEND_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<undefined, GatewayApp>) =>
    app.spendPipeline({ participation }),
  connect: ({ app, commands }) => app.connectSpend(commands),
});
