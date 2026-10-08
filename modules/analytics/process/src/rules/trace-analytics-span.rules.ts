import { CODEX_EXEC_SCOPE, isCodexScope } from "@langwatch/coding-agent-contract";
import { estimateModelCost, getStaticModelCostRates } from "@langwatch/model-provider-contract";
import {
  ATTR_KEYS,
  canonicaliseLogRecord,
  canonicaliseSpanAttributes,
  orderedSpanCanonicalisers,
} from "@langwatch/span-normalisation";
import {
  type CanonicalizeLogRecordInput,
  type CanonicalizeLogRecordResult,
  canonicalizeLogRecordInputSchema,
  canonicalizeLogRecordResultSchema,
  canonicalizeSpanAttributesInputSchema,
  canonicalizeSpanAttributesResultSchema,
  deriveSpanPriceInput,
  isSpanTokenAccumulationSkipped,
  type NormalizedSpan,
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
} from "@langwatch/trace-contract";
import { decodeOtlpSpan, deriveRagContextsWithIds } from "@langwatch/trace-contract/otlp-decoding";

/** The same ordered canonicalisers trace's span storage and summary fold apply. */
const SPAN_CANONICALISERS = orderedSpanCanonicalisers({
  codexScopes: { isCodexScope, execScope: CODEX_EXEC_SCOPE },
});

/** A received OTLP span decoded, canonicalised and RAG-id enriched, as trace reads it. */
export function normaliseTraceSpan({
  tenantId,
  span,
  resource,
  instrumentationScope,
}: {
  tenantId: string;
  span: OtlpSpan;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
}): NormalizedSpan {
  const decoded = decodeOtlpSpan({
    tenantId,
    otlpSpan: span,
    otlpResource: resource,
    otlpInstrumentationScope: instrumentationScope,
  });
  const input = canonicalizeSpanAttributesInputSchema.parse({
    spanAttributes: decoded.spanAttributes,
    events: decoded.events,
    span: decoded,
  });
  const canonical = canonicalizeSpanAttributesResultSchema.parse(
    canonicaliseSpanAttributes({ canonicalisers: SPAN_CANONICALISERS, ...input }),
  );
  const ragContexts = deriveRagContextsWithIds(canonical.attributes);

  return {
    ...decoded,
    spanAttributes:
      ragContexts === undefined
        ? canonical.attributes
        : { ...canonical.attributes, [ATTR_KEYS.LANGWATCH_RAG_CONTEXTS]: ragContexts },
    events: canonical.events,
  };
}

/** A log record's attributes lifted by the same canonicalisers. */
export function canonicaliseTraceLogRecord(
  input: CanonicalizeLogRecordInput,
): CanonicalizeLogRecordResult {
  const parsed = canonicalizeLogRecordInputSchema.parse(input);

  return canonicalizeLogRecordResultSchema.parse(
    canonicaliseLogRecord({ canonicalisers: SPAN_CANONICALISERS, ...parsed }),
  );
}

/** The span's own price (USD) from the static model rates (round 18), as trace prices it. */
export function priceTraceSpan(span: NormalizedSpan): number {
  const input = deriveSpanPriceInput(span);

  return estimateModelCost(
    {
      attrs: input.attributes,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    },
    getStaticModelCostRates(),
  );
}

/** What a span adds to its trace's running cost: nothing when it skips token accumulation. */
export function priceAccumulatedTraceSpan(span: NormalizedSpan): number {
  return isSpanTokenAccumulationSkipped(span) ? 0 : priceTraceSpan(span);
}
