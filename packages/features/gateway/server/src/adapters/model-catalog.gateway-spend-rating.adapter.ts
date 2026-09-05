import {
  estimateCost,
  getStaticModelCostRates,
  llmModels,
  matchModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { GatewaySpendRatingPort } from "../ports/gateway-spend-rating.port";
import type { SpendUsage } from "../processes/gateway-spend-commands.process";

/**
 * Rating for the gateway spend pipeline: quantities in, integer nano-USD out, quantized exactly once here via the same estimateCost cascade the trace pipeline prices with. float64 is exact for integers to 2^53, so a JS number carries losslessly into ClickHouse's Int64. Rating is deterministic per (model, quantities, rate_version): a replay re-rates identically unless the registry changed, which is what makes re-rating a projection rebuild rather than a correction event stream.
 */

export const NANO_USD_PER_USD = 1_000_000_000;

const logger = createLogger("langwatch:gateway-spend:rating");

/** Quantities reported for display that no rate ever prices. A request that
 *  carried only these measured nothing billable. */
const UNPRICED_QUANTITY_NAMES = new Set<string>(["image_count"]);

/**
 * The billable quantities a request reported, with the zeroes dropped. Empty
 * means the request measured nothing at all, so a zero charge is the right
 * answer and there is nothing to warn about.
 */
function measuredQuantities(usage: SpendUsage): Record<string, number> {
  const measured: Record<string, number> = {};
  for (const [name, value] of Object.entries(usage)) {
    if (UNPRICED_QUANTITY_NAMES.has(name)) continue;
    if (typeof value === "number" && value > 0) measured[name] = value;
  }
  return measured;
}

/** Stable identities for the two catalog faults. The message beside them is
 *  copy; these are what an alert or a log filter keys on. */
export const UNPRICED_QUANTITIES_CODE = "spend_rating.unpriced_quantities";
export const NO_RATE_RULE_CODE = "spend_rating.no_rate_rule";

/**
 * A rule whose every rate is zero is a deliberately free/bundled model (e.g. codex entries billed via the caller's own subscription) — charging nothing is correct there, not a catalog fault. A rule that prices SOMETHING but nothing this request reported IS the fault worth stating.
 */
function pricesAnything(rule: ModelCostRate): boolean {
  return [
    rule.inputCostPerToken,
    rule.outputCostPerToken,
    rule.cacheReadCostPerToken,
    rule.cacheCreationCostPerToken,
    rule.cacheCreation1hCostPerToken,
    rule.inputAudioCostPerToken,
    rule.outputAudioCostPerToken,
    rule.inputImageCostPerToken,
    rule.outputImageCostPerToken,
    rule.inputCostPerCharacter,
    rule.inputCostPerSecond,
  ].some((rate) => (rate ?? 0) > 0);
}

/**
 * States once per request that pricing failed. Two faults land here: an unknown model (warned elsewhere) and a model whose entry prices none of the reported quantities (e.g. gpt-4o transcribe priced per-second while the provider reports tokens, settling at $0 indistinguishable from free) — only visible where quantities meet rates. A request that measured nothing is not a fault; an unknown model still warns.
 */
function warnUnpriced({
  model,
  usage,
  rule,
  rateVersion,
}: {
  model: string;
  usage: SpendUsage;
  rule: ModelCostRate | undefined;
  rateVersion: string;
}): void {
  if (!model || model === "unknown") return;
  const measured = measuredQuantities(usage);
  const burnedSomething = Object.keys(measured).length > 0;
  if (rule) {
    if (!burnedSomething || !pricesAnything(rule)) return;
    logger.warn(
      { code: UNPRICED_QUANTITIES_CODE, model, rateVersion, measured },
      "rate rule prices none of the quantities this request reported; spend rated at zero",
    );
    return;
  }
  logger.warn(
    { code: NO_RATE_RULE_CODE, model, rateVersion, measured },
    "no rate rule matched; spend rated at zero",
  );
}

/**
 * The vertical's ONE rating seam over the static catalog: a class satisfying {@link GatewaySpendRatingPort}, not a bare function, since voice settlement and the data plane's drainer both take the same port — two implementations would price one call twice. Arithmetic is {@link rateSpendNanoUsd}, unchanged, so a replay re-rates identically unless the catalog moved.
 */
export class ModelCatalogGatewaySpendRatingAdapter extends GatewaySpendRatingPort {
  static create(): ModelCatalogGatewaySpendRatingAdapter {
    return new ModelCatalogGatewaySpendRatingAdapter();
  }

  rate(input: { model: string; usage: SpendUsage; rateVersion?: string }): {
    costNanoUsd: number;
    rateVersion: string;
  } {
    return this.rateSpendNanoUsd(input);
  }

  /** Rate identity stamped when the confirm event carried none: the model
   *  registry's own regeneration timestamp, date-granular. */
  currentRegistryRateVersion(): string {
    const date = (llmModels.updatedAt ?? "").slice(0, 10);
    return date ? `registry@${date}` : "registry@unversioned";
  }

  rateSpendNanoUsd({
    model,
    usage,
    rateVersion,
  }: {
    model: string;
    usage: SpendUsage;
    rateVersion?: string;
  }): { costNanoUsd: number; rateVersion: string } {
    const rate = matchModelCost(model, getStaticModelCostRates());
    const usd = rate
      ? estimateCost({
          rate,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          cacheCreation1hTokens: usage.cache_creation_1h_tokens,
          inputAudioTokens: usage.input_audio_tokens,
          outputAudioTokens: usage.output_audio_tokens,
          inputImageTokens: usage.input_image_tokens,
          outputImageTokens: usage.output_image_tokens,
          inputCharacters: usage.input_chars,
          // The one conversion of the duration quantity: it is integer
          // milliseconds everywhere else, and per-second rates apply here.
          audioSeconds: usage.audio_ms / 1000,
        })
      : 0;
    const costNanoUsd = Math.round((usd ?? 0) * NANO_USD_PER_USD);
    const stamp =
      rateVersion && rateVersion.length > 0 ? rateVersion : this.currentRegistryRateVersion();
    if (costNanoUsd === 0) {
      warnUnpriced({ model, usage, rule: rate, rateVersion: stamp });
    }
    return { costNanoUsd, rateVersion: stamp };
  }
}
