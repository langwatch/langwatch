import { createLogger } from "@langwatch/observability";
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

const logger = createLogger("langwatch:gateway-spend:rating");

/**
 * The quantities a request reported, with the zeroes dropped. Empty means the
 * request measured nothing at all, so a zero charge is the right answer and
 * there is nothing to warn about.
 */
function measuredQuantities(usage: SpendUsage): Record<string, number> {
  const measured: Record<string, number> = {};
  for (const [name, value] of Object.entries(usage)) {
    if (typeof value === "number" && value > 0) measured[name] = value;
  }
  return measured;
}

/**
 * States, once per request, that the catalog could not price it.
 *
 * Two faults reach this point and only the first was ever visible. A model
 * with no entry at all was warned about. A model WITH an entry that prices
 * none of the quantities the request reported was not: the gpt-4o transcribe
 * pair carried a per-second rate while the provider reports tokens and no
 * duration, so every call multiplied that rate by zero seconds and settled at
 * $0 with real usage on the row, indistinguishable from a free request. Both
 * faults are only visible here, where quantities meet rates.
 *
 * A request that measured nothing is not a fault of either kind, so a rule
 * that prices it at zero says nothing. An unknown model still warns even then,
 * because the catalog gap is worth knowing about before a call carries usage.
 */
function warnUnpriced({
  model,
  usage,
  matched,
  rateVersion,
}: {
  model: string;
  usage: SpendUsage;
  matched: boolean;
  rateVersion: string;
}): void {
  if (!model || model === "unknown") return;
  const measured = measuredQuantities(usage);
  const burnedSomething = Object.keys(measured).length > 0;
  if (matched) {
    if (!burnedSomething) return;
    logger.warn(
      { model, rateVersion, measured },
      "rate rule prices none of the quantities this request reported; spend rated at zero",
    );
    return;
  }
  logger.warn(
    { model, rateVersion, measured },
    "no rate rule matched; spend rated at zero",
  );
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
        cacheCreation1hTokens: usage.cache_creation_1h_tokens,
        inputAudioTokens: usage.input_audio_tokens,
        outputAudioTokens: usage.output_audio_tokens,
        inputCharacters: usage.input_chars,
        // The one conversion of the duration quantity: it is integer
        // milliseconds everywhere else, and per-second rates apply here.
        audioSeconds: usage.audio_ms / 1000,
      })
    : 0;
  const costNanoUsd = Math.round((usd ?? 0) * NANO_USD_PER_USD);
  const stamp =
    rateVersion && rateVersion.length > 0
      ? rateVersion
      : currentRegistryRateVersion();
  if (costNanoUsd === 0) {
    warnUnpriced({
      model,
      usage,
      matched: llmModelCost != null,
      rateVersion: stamp,
    });
  }
  return { costNanoUsd, rateVersion: stamp };
}
