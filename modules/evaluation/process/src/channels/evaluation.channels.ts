import type { GatewayApi } from "@langwatch/gateway-contract";

import type { LangevalsChannel } from "./langevals.channel.ts";

/** Where langevals' provider usage is written: the gateway's spend ledger (ADR-193). */
export type EvaluationProviderSpend = Pick<GatewayApi, "recordProviderUsage">;

/** Every channel evaluation holds; langevals answers skipped where no endpoint is set. */
export interface EvaluationChannels {
  readonly langevals: LangevalsChannel;
  readonly spend: EvaluationProviderSpend;
}
