import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { llmModels } from "~/server/modelProviders/loadModelCatalog";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/tracer/collector/cost";
import type { SpendUsage } from "../schemas/commands";

/**
 * Rating for the gateway spend pipeline: quantities in, integer nano-USD out.
 *
 * Money discipline (spend-command spine): integers only, and the request's
 * cost is quantized to nano-USD exactly once, here. Token counts are exact
 * integers; the per-token registry rates are applied through the same
 * `estimateCost` cascade the trace pipeline prices with (so a request never
 * prices differently in billing than in observability), and the resulting
 * USD figure is rounded to integer nano-USD (1e-9). Downstream sums stay in
 * integers; the single further rounding belongs to the customer's invoice.
 *
 * float64 is exact for integers to 2^53 (~$9e6 in nano-USD would need one
 * request to cost $9.2M before precision entered the picture), so a JS
 * number carries the value losslessly into ClickHouse's Int64 column.
 *
 * Rating is deterministic per (model, quantities, rate_version): a replay
 * re-rates to the identical value unless the registry changed, and then the
 * changed `rate_version` stamp says so. That is what makes re-rating a
 * projection rebuild instead of a correction event stream.
 */

export const NANO_USD_PER_USD = 1_000_000_000;

/** Rate identity stamped when the confirm event carried none: the model
 *  registry's own regeneration timestamp, date-granular. */
export function currentRegistryRateVersion(): string {
  const date = (llmModels.updatedAt ?? "").slice(0, 10);
  return date ? `registry@${date}` : "registry@unversioned";
}

export function rateSpendNanoUsd({
  model,
  usage,
  rateVersion,
}: {
  model: string;
  usage: SpendUsage;
  rateVersion?: string;
}): { costNanoUsd: number; rateVersion: string } {
  const llmModelCost = matchModelCostWithFallbacks(
    model,
    getStaticModelCosts(),
  );
  const usd = llmModelCost
    ? estimateCost({
        llmModelCost,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
      })
    : 0;
  return {
    costNanoUsd: Math.round((usd ?? 0) * NANO_USD_PER_USD),
    rateVersion:
      rateVersion && rateVersion.length > 0
        ? rateVersion
        : currentRegistryRateVersion(),
  };
}
