import type { GatewayApi } from "@langwatch/gateway-contract";

import type { EvaluationInstantEvalResults } from "./evaluation-instant-eval-results.channel.ts";
import type { LangevalsChannel } from "./langevals.channel.ts";

/** Where langevals' provider usage is written: the gateway's spend ledger (ADR-193). */
export type EvaluationProviderSpend = Pick<GatewayApi, "recordProviderUsage">;

/** Every channel evaluation holds; langevals answers skipped where no endpoint is set. */
export interface EvaluationChannels {
  readonly langevals: LangevalsChannel;
  readonly spend: EvaluationProviderSpend;
  /** A monitor's kept Instant Evals verdicts in instant-eval's eval_results (ADR-189 section 5). */
  readonly instantEvalResults: EvaluationInstantEvalResults;
}
