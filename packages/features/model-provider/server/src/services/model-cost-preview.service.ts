/**
 * The cost-rule drawer's live preview, and the span detail's "you have no rate
 * for this model" hint.
 *
 * Both answer one question — would THIS rule price THAT span — and both must
 * answer it exactly the way the ingestion pipeline will, so matching runs
 * through the contract's own `matchModelCost` cascade rather than a second
 * implementation of it. A preview that matched differently from the rule would
 * talk somebody into a pricing rule that then prices nothing.
 *
 * The span reader arrives per call rather than as a construction dependency:
 * it is the REQUEST's reader, so the preview reads through the same
 * request-scoped services as the rest of the call instead of a process
 * singleton.
 */
import {
  estimateCost,
  matchModelCost,
  type CostRuleMatchingSpansPreview,
  type CostRulePreviewInput,
  type CostRulePreviewSampleSpan,
  type ModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import { ValidationError } from "@langwatch/handled-error";
import { compileSafeRegex } from "./model-cost-regex-safety.service";

/**
 * How far back the preview looks for spans. Wide enough to catch models that
 * only run a few times a week, narrow enough to stay on warm partitions.
 */
export const PREVIEW_WINDOW_DAYS = 7;

/** Project-wide distinct-model inventory cap for one preview round. */
const MAX_DISTINCT_MODELS = 500;

/** Sample-span list shown under the regex field. */
const MAX_SAMPLE_SPANS = 10;
const PER_MODEL_SAMPLE_LIMIT = 3;

/** Non-matching models surfaced in the zero/partial-match hint. */
const MAX_UNMATCHED_MODELS = 8;

/**
 * The two span reads the preview issues, declared structurally.
 *
 * Structural rather than an abstract port because the reader is the trace
 * feature's, and a model-provider port class would be this package declaring
 * another feature's collaborator. The process passes its own; this names the
 * two methods it has to answer.
 */
export type ModelCostPreviewSpanReader = Readonly<{
  getModelUsageStats(input: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<Array<{ model: string; spanCount: number; lastSeenMs: number }>>;
  getRecentSpansByModels(input: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<
    Array<{
      traceId: string;
      spanId: string;
      spanName: string;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheCreationTokens: number | null;
      cacheCreation1hTokens: number | null;
      startTimeMs: number;
    }>
  >;
}>;

/**
 * The rates the unmapped-cost hint checks a span's model against: the
 * project's own rules first, then the platform registry — the same order and
 * the same two sources record-time pricing reads.
 */
export type ModelCostRuleReader = Readonly<{
  listCosts(input: { projectId: string }): Promise<ModelCost[]>;
  staticCostRates(): readonly ModelCostRate[];
}>;

/** The rule being typed, as one catalogue rate. */
function candidateRate(input: CostRulePreviewInput): ModelCostRate {
  return {
    model: input.model ?? input.regex,
    regex: input.regex,
    ...(input.inputCostPerToken !== undefined
      ? { inputCostPerToken: input.inputCostPerToken }
      : {}),
    ...(input.outputCostPerToken !== undefined
      ? { outputCostPerToken: input.outputCostPerToken }
      : {}),
    ...(input.cacheReadCostPerToken !== undefined
      ? { cacheReadCostPerToken: input.cacheReadCostPerToken }
      : {}),
    ...(input.cacheCreationCostPerToken !== undefined
      ? { cacheCreationCostPerToken: input.cacheCreationCostPerToken }
      : {}),
    ...(input.cacheCreation1hCostPerToken !== undefined
      ? { cacheCreation1hCostPerToken: input.cacheCreation1hCostPerToken }
      : {}),
  };
}

/** A stored rule as the matching cascade reads it. */
function storedRate(cost: ModelCost): ModelCostRate {
  return {
    model: cost.model,
    regex: cost.regex,
    ...(cost.inputCostPerToken !== null ? { inputCostPerToken: cost.inputCostPerToken } : {}),
    ...(cost.outputCostPerToken !== null ? { outputCostPerToken: cost.outputCostPerToken } : {}),
    ...(cost.cacheReadCostPerToken !== null
      ? { cacheReadCostPerToken: cost.cacheReadCostPerToken }
      : {}),
    ...(cost.cacheCreationCostPerToken !== null
      ? { cacheCreationCostPerToken: cost.cacheCreationCostPerToken }
      : {}),
    ...(cost.cacheCreation1hCostPerToken !== null
      ? { cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken }
      : {}),
  };
}

/**
 * Previews which of the project's recently-seen models (and sample spans) a
 * cost rule's regex would match.
 */
export async function previewCostRuleMatchingSpans({
  spans,
  input,
}: {
  spans: ModelCostPreviewSpanReader;
  input: CostRulePreviewInput;
}): Promise<CostRuleMatchingSpansPreview> {
  if (!compileSafeRegex(input.regex)) {
    throw new ValidationError("Invalid or unsafe regular expression");
  }

  const candidate = candidateRate(input);
  const fromMs = Date.now() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const stats = await spans.getModelUsageStats({
    tenantId: input.projectId,
    fromMs,
    limit: MAX_DISTINCT_MODELS,
  });

  const matchedModels: CostRuleMatchingSpansPreview["matchedModels"] = [];
  const unmatchedModels: CostRuleMatchingSpansPreview["unmatchedModels"] = [];
  for (const stat of stats) {
    if (matchModelCost(stat.model, [candidate])) {
      matchedModels.push(stat);
    } else if (unmatchedModels.length < MAX_UNMATCHED_MODELS) {
      unmatchedModels.push({ model: stat.model, spanCount: stat.spanCount });
    }
  }

  let sampleSpans: CostRulePreviewSampleSpan[] = [];
  if (matchedModels.length > 0) {
    const rows = await spans.getRecentSpansByModels({
      tenantId: input.projectId,
      models: matchedModels.map((m) => m.model),
      fromMs,
      perModelLimit: PER_MODEL_SAMPLE_LIMIT,
      limit: MAX_SAMPLE_SPANS,
    });
    sampleSpans = rows.map((row) => {
      const hasTokenUsage =
        row.inputTokens !== null ||
        row.outputTokens !== null ||
        row.cacheReadTokens !== null ||
        row.cacheCreationTokens !== null;
      return {
        ...row,
        exampleCost: !hasTokenUsage
          ? null
          : (estimateCost({
              rate: candidate,
              inputTokens: row.inputTokens ?? 0,
              outputTokens: row.outputTokens ?? 0,
              cacheReadTokens: row.cacheReadTokens ?? 0,
              cacheCreationTokens: row.cacheCreationTokens ?? 0,
              cacheCreation1hTokens: row.cacheCreation1hTokens ?? 0,
              inputAudioTokens: 0,
              outputAudioTokens: 0,
            }) ?? null),
      };
    });
  }

  return {
    windowDays: PREVIEW_WINDOW_DAYS,
    totalMatchedSpans: matchedModels.reduce((sum, m) => sum + m.spanCount, 0),
    matchedModels,
    sampleSpans,
    unmatchedModels,
  };
}

/**
 * Whether a span's detail view should suggest creating a model cost mapping:
 * the span names a model and carries token usage, yet no cost was computed for
 * it AND no stored rule matches the model. The last check keeps the suggestion
 * off spans that pre-date a rule the reader already created.
 */
export async function deriveUnmappedCostSuggestion({
  costs,
  projectId,
  model,
  cost,
  promptTokens,
  completionTokens,
}: {
  costs: ModelCostRuleReader;
  projectId: string;
  model: string | null;
  cost: number | null | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}): Promise<{ model: string } | null> {
  if (!model) return null;
  if (cost != null) return null;
  const hasTokens = (promptTokens ?? 0) > 0 || (completionTokens ?? 0) > 0;
  if (!hasTokens) return null;

  const stored = await costs.listCosts({ projectId });
  const rates = [...stored.map(storedRate), ...costs.staticCostRates()];
  if (matchModelCost(model, rates)) return null;

  return { model };
}
