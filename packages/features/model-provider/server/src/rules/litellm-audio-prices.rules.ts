import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";

/**
 * Audio, transcription and realtime model prices from litellm's community
 * price registry. OpenRouter, the primary catalog source, routes none of
 * these models, so litellm is the source for this family.
 *
 * Units: litellm prices audio models by character, by second, or by token,
 * per model rather than per mode, so every unit present is read and mapped.
 *
 * Representability: a model is emitted only when `LLMModelPricing` can
 * express every rate litellm publishes for it. When it cannot, the model is
 * reported through `unrepresentable` rather than dropped in silence, because
 * a model that reaches the gateway with a partial price bills confidently
 * and wrongly.
 *
 * Precedence: ids already present in the overlay are excluded by the caller,
 * so a hand-written correction is never contested by this mapping.
 */

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** The subset of a litellm price entry this mapper reads. */
export type LitellmPriceEntry = {
  mode?: string;
  litellm_provider?: string;
  input_cost_per_character?: number;
  input_cost_per_second?: number;
  input_cost_per_token?: number;
  input_cost_per_audio_token?: number;
  output_cost_per_token?: number;
  output_cost_per_audio_token?: number;
  output_cost_per_second?: number;
  output_cost_per_character?: number;
  cache_read_input_token_cost?: number;
};

/** A model upstream prices but the catalog cannot express yet. */
export type UnrepresentableModel = {
  id: string;
  fields: string[];
};

export type LitellmAudioMapping = {
  entries: LLMModelEntry[];
  unrepresentable: UnrepresentableModel[];
};

/** Providers whose audio models the LangWatch gateway can serve. */
const AUDIO_PROVIDERS = ["openai", "elevenlabs"];

/** litellm modes this mapper covers. */
const AUDIO_MODES = ["audio_speech", "audio_transcription", "realtime"];

/** Dated snapshot ids (e.g. gpt-4o-mini-transcribe-2025-03-20) are noise. */
const DATED_VARIANT = /-\d{4}-\d{2}-\d{2}$/;

const positive = (value: number | undefined): number | undefined =>
  typeof value === "number" && value > 0 ? value : undefined;

/**
 * litellm rates that would change the bill and have no `LLMModelPricing`
 * field. An output rate equal to its input counterpart needs no separate
 * field; only a genuinely different rate is unrepresentable.
 */
function unrepresentableFields(price: LitellmPriceEntry): string[] {
  const fields: string[] = [];
  const differs = (a: number | undefined, b: number | undefined): boolean =>
    positive(a) !== undefined && positive(a) !== positive(b);

  if (differs(price.output_cost_per_second, price.input_cost_per_second)) {
    fields.push("output_cost_per_second");
  }
  if (differs(price.output_cost_per_character, price.input_cost_per_character)) {
    fields.push("output_cost_per_character");
  }
  return fields;
}

/** Maps the litellm rate set onto catalog pricing fields. */
function toPricing(price: LitellmPriceEntry): LLMModelPricing | null {
  const pricing: LLMModelPricing = {
    inputCostPerToken: positive(price.input_cost_per_token) ?? 0,
    outputCostPerToken: positive(price.output_cost_per_token) ?? 0,
  };

  const perCharacter = positive(price.input_cost_per_character);
  if (perCharacter !== undefined) pricing.inputCostPerCharacter = perCharacter;

  const perSecond = positive(price.input_cost_per_second);
  if (perSecond !== undefined) pricing.inputCostPerSecond = perSecond;

  const perAudioToken = positive(price.input_cost_per_audio_token);
  if (perAudioToken !== undefined) pricing.audioCostPerToken = perAudioToken;

  const perAudioOutputToken = positive(price.output_cost_per_audio_token);
  if (perAudioOutputToken !== undefined) pricing.audioOutputCostPerToken = perAudioOutputToken;

  const cacheRead = positive(price.cache_read_input_token_cost);
  if (cacheRead !== undefined) pricing.inputCacheReadPerToken = cacheRead;

  const priced =
    pricing.inputCostPerToken > 0 ||
    pricing.outputCostPerToken > 0 ||
    pricing.inputCostPerCharacter !== undefined ||
    pricing.inputCostPerSecond !== undefined;

  return priced ? pricing : null;
}

function describe(mode: string, pricing: LLMModelPricing): string {
  const unit =
    pricing.inputCostPerCharacter !== undefined
      ? "per input character"
      : pricing.inputCostPerSecond !== undefined
        ? "per second of audio"
        : "per token";
  const kind =
    mode === "audio_speech"
      ? "Speech synthesis"
      : mode === "realtime"
        ? "Realtime audio"
        : "Speech-to-text";
  return `${kind}, priced ${unit}. Synced from litellm's price registry.`;
}

/**
 * Maps litellm audio price entries to catalog entries: `audio_speech`,
 * `audio_transcription` and `realtime` entries from supported providers
 * that carry at least one expressible rate and no inexpressible one. Ids in
 * `excludeIds` (the overlay's own ids) are skipped.
 */
export function mapLitellmAudioModels(
  prices: Record<string, LitellmPriceEntry>,
  excludeIds: ReadonlySet<string>,
): LitellmAudioMapping {
  const entries: LLMModelEntry[] = [];
  const unrepresentable: UnrepresentableModel[] = [];

  for (const [rawId, price] of Object.entries(prices)) {
    const mode = price.mode ?? "";
    if (!AUDIO_MODES.includes(mode)) continue;

    const provider = price.litellm_provider ?? "";
    if (!AUDIO_PROVIDERS.includes(provider)) continue;
    if (DATED_VARIANT.test(rawId)) continue;

    const id = rawId.includes("/") ? rawId : `${provider}/${rawId}`;
    if (excludeIds.has(id)) continue;

    const missing = unrepresentableFields(price);
    if (missing.length > 0) {
      unrepresentable.push({ id, fields: missing });
      continue;
    }

    const pricing = toPricing(price);
    if (!pricing) continue;

    const isSpeech = mode === "audio_speech";
    const isRealtime = mode === "realtime";
    const modelName = id.split("/").slice(1).join("/");

    entries.push({
      id,
      name: modelName,
      provider,
      pricing,
      contextLength: 0,
      maxCompletionTokens: null,
      supportedParameters: [],
      defaultParameters: null,
      modality: isRealtime ? "audio->audio" : isSpeech ? "text->audio" : "audio->text",
      mode: "audio",
      description: describe(mode, pricing),
      supportsImageInput: false,
      supportsAudioInput: !isSpeech,
      supportsImageOutput: false,
      supportsAudioOutput: isSpeech || isRealtime,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  unrepresentable.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, unrepresentable };
}

/**
 * Catalog-shaped pricing for every model litellm publishes, keyed by catalog
 * id. Wider than `mapLitellmAudioModels` on purpose — every mode and
 * provider — because the drift audit compares whatever it CAN express
 * against the overlay's hand-written rates.
 */
export function litellmPricingById(
  prices: Record<string, LitellmPriceEntry>,
): Record<string, LLMModelPricing> {
  const byId: Record<string, LLMModelPricing> = {};
  for (const [rawId, price] of Object.entries(prices)) {
    if (DATED_VARIANT.test(rawId)) continue;
    const pricing = toPricing(price);
    if (!pricing) continue;
    const provider = price.litellm_provider ?? "";
    byId[rawId.includes("/") ? rawId : `${provider}/${rawId}`] = pricing;
  }
  return byId;
}

/** Fetches litellm's price registry. Returns null on any transport failure. */
export async function fetchLitellmPrices(): Promise<Record<string, LitellmPriceEntry> | null> {
  try {
    const response = await fetch(LITELLM_PRICES_URL);
    if (!response.ok) return null;
    return (await response.json()) as Record<string, LitellmPriceEntry>;
  } catch {
    return null;
  }
}
