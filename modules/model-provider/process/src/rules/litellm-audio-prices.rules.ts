import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { z } from "zod";

/**
 * Audio/transcription/realtime prices from litellm's registry — OpenRouter routes none of these
 * models. A model whose rates `LLMModelPricing` can't fully express is reported via
 * `unrepresentable` rather than dropped, so it never bills confidently on a partial price.
 */

/** The subset of a litellm price entry this mapper reads, parsed where the body enters. */
export const litellmPriceEntrySchema = z.object({
  mode: z.string().optional(),
  litellm_provider: z.string().optional(),
  input_cost_per_character: z.number().optional(),
  input_cost_per_second: z.number().optional(),
  input_cost_per_token: z.number().optional(),
  input_cost_per_audio_token: z.number().optional(),
  output_cost_per_token: z.number().optional(),
  output_cost_per_audio_token: z.number().optional(),
  output_cost_per_second: z.number().optional(),
  output_cost_per_character: z.number().optional(),
  cache_read_input_token_cost: z.number().optional(),
});

export type LitellmPriceEntry = z.infer<typeof litellmPriceEntrySchema>;

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

const pickPositive = (value: number | undefined): number | undefined =>
  typeof value === "number" && value > 0 ? value : undefined;

/**
 * litellm rates that would change the bill and have no `LLMModelPricing`
 * field. An output rate equal to its input counterpart needs no separate
 * field; only a genuinely different rate is unrepresentable.
 */
function unrepresentableFields(price: LitellmPriceEntry): string[] {
  const fields: string[] = [];
  const differs = (a: number | undefined, b: number | undefined): boolean =>
    pickPositive(a) !== undefined && pickPositive(a) !== pickPositive(b);

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
    inputCostPerToken: pickPositive(price.input_cost_per_token) ?? 0,
    outputCostPerToken: pickPositive(price.output_cost_per_token) ?? 0,
  };

  const perCharacter = pickPositive(price.input_cost_per_character);
  if (perCharacter !== undefined) pricing.inputCostPerCharacter = perCharacter;

  const perSecond = pickPositive(price.input_cost_per_second);
  if (perSecond !== undefined) pricing.inputCostPerSecond = perSecond;

  const perAudioToken = pickPositive(price.input_cost_per_audio_token);
  if (perAudioToken !== undefined) pricing.audioCostPerToken = perAudioToken;

  const perAudioOutputToken = pickPositive(price.output_cost_per_audio_token);
  if (perAudioOutputToken !== undefined) pricing.audioOutputCostPerToken = perAudioOutputToken;

  const cacheRead = pickPositive(price.cache_read_input_token_cost);
  if (cacheRead !== undefined) pricing.inputCacheReadPerToken = cacheRead;

  const priced =
    pricing.inputCostPerToken > 0 ||
    pricing.outputCostPerToken > 0 ||
    pricing.inputCostPerCharacter !== undefined ||
    pricing.inputCostPerSecond !== undefined;

  return priced ? pricing : null;
}

function describe(mode: string, pricing: LLMModelPricing): string {
  const durationUnit =
    pricing.inputCostPerSecond !== undefined ? "per second of audio" : "per token";
  const unit = pricing.inputCostPerCharacter !== undefined ? "per input character" : durationUnit;
  const listeningKind = mode === "realtime" ? "Realtime audio" : "Speech-to-text";
  const kind = mode === "audio_speech" ? "Speech synthesis" : listeningKind;
  return `${kind}, priced ${unit}. Synced from litellm's price registry.`;
}

/**
 * Maps litellm audio price entries to catalog entries: `audio_speech`,
 * `audio_transcription` and `realtime` from supported providers with at
 * least one expressible rate and none inexpressible. `excludeIds` skips the overlay's own ids.
 */
export function mapLitellmAudioModels(
  prices: Record<string, LitellmPriceEntry>,
  excludeIds: ReadonlySet<string>,
): LitellmAudioMapping {
  const entries: LLMModelEntry[] = [];
  const unrepresentable: UnrepresentableModel[] = [];

  for (const [rawId, price] of Object.entries(prices)) {
    if (!isCurrentAudioPrice(rawId, price)) continue;
    const mode = price.mode ?? "";
    const provider = price.litellm_provider ?? "";

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
      modality: audioModalityOf({ isRealtime, isSpeech }),
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
 * Catalog-shaped pricing for every model litellm publishes, keyed by
 * catalog id. Wider than `mapLitellmAudioModels` on purpose, since the
 * drift audit compares whatever it CAN express against the overlay's rates.
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

function audioModalityOf({ isRealtime, isSpeech }: { isRealtime: boolean; isSpeech: boolean }) {
  if (isRealtime) return "audio->audio";
  return isSpeech ? "text->audio" : "audio->text";
}

function isCurrentAudioPrice(rawId: string, price: LitellmPriceEntry): boolean {
  if (!AUDIO_MODES.includes(price.mode ?? "")) return false;
  if (!AUDIO_PROVIDERS.includes(price.litellm_provider ?? "")) return false;
  return !DATED_VARIANT.test(rawId);
}
