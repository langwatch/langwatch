import {
  elasticSearchToTypedValue,
  elasticSearchEventsToEvents,
  elasticSearchEvaluationsToEvaluations,
} from "../tracer/utils";
import {
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type Evaluation,
  type ReservedTraceMetadata,
  type Span,
  type SpanInputOutput,
  type Event,
  type Trace,
  type SpanMetrics,
  type TraceInput,
  type TraceOutput,
  type DatasetSpan,
} from "../tracer/types";
import { datasetSpanSchema } from "../datasets/types";
import { z } from "zod";
import { reservedTraceMetadataSchema } from "../tracer/types.generated";
import type { Protections } from "./protections";
import { createLogger } from "../../utils/logger";
import { parsePythonInsideJson } from "../../utils/parsePythonInsideJson";

const logger = createLogger("langwatch:elasticsearch:transformers");

export const esSpansToDatasetSpans = (spans: Span[]): DatasetSpan[] => {
  try {
    return z.array(datasetSpanSchema).parse(spans);
  } catch (e) {
    logger.error({ error: e }, "DatasetSpan validation failed");
    return spans as unknown as DatasetSpan[];
  }
};

export const transformElasticSearchTraceToTrace = (
  elasticSearchTrace: ElasticSearchTrace,
  protections: Protections
): Trace => {
  const {
    metadata = {},
    events,
    evaluations,
    spans,
    input,
    output,
    metrics,
    ...traceFields
  } = elasticSearchTrace;

  const reservedMetadata = Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => key in reservedTraceMetadataSchema.shape
    )
  ) as ReservedTraceMetadata;
  const customMetadata = metadata.custom;

  let transformedEvents: Event[] = [];
  let transformedEvaluations: Evaluation[] = [];
  let transformedSpans: Span[] = [];

  let transformedInput: TraceInput | undefined = void 0;
  let transformedOutput: TraceOutput | undefined = void 0;
  let transformedMetrics: Trace["metrics"] | undefined = void 0;

  let redactions: Set<string> = new Set([
    ...(!protections.canSeeCapturedInput ? extractRedactionsForObject(input) : []),
    ...(!protections.canSeeCapturedOutput ? extractRedactionsForObject(output) : []),
  ]);

  if (input && protections.canSeeCapturedInput === true) {
    transformedInput = redactObject(input, redactions);
  }
  if (output && protections.canSeeCapturedOutput === true) {
    transformedOutput = redactObject(output, redactions);
  }

  if (!protections.canSeeCapturedInput) {
    redactions = new Set([
      ...redactions,
      ...extractRedactionsFromAllSpanInputs(spans),
    ]);
  }
  if (!protections.canSeeCapturedOutput) {
    redactions = new Set([
      ...redactions,
      ...extractRedactionsFromAllSpanOutputs(spans),
    ]);
  }

  if (metrics) {
    const { total_cost, ...otherMetrics } = metrics;
    transformedMetrics = otherMetrics;

    if (protections.canSeeCosts === true) {
      transformedMetrics.total_cost = total_cost;
    }
  }
  if (events) {
    transformedEvents = elasticSearchEventsToEvents(events);
  }
  if (evaluations) {
    transformedEvaluations = elasticSearchEvaluationsToEvaluations(evaluations);
  }
  if (spans) {
    for (const span of spans) {
      transformedSpans.push(
        transformElasticSearchSpanToSpan(span, protections, redactions)
      );
    }
  }

  return {
    ...traceFields,
    metadata: {
      ...customMetadata,
      ...reservedMetadata, // TODO(afr): I switched this, so that reserved metadata always takes precedence over custom metadata
    },
    events: transformedEvents,
    evaluations: transformedEvaluations,
    spans: transformedSpans,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
  };
};

export const transformElasticSearchSpanToSpan = (
  esSpan: ElasticSearchSpan,
  protections: Protections,
  redactions: Set<string>
): Span => {
  const { input, output, metrics, ...spanFields } = esSpan;

  let transformedInput: SpanInputOutput | null = null;
  let transformedOutput: SpanInputOutput | null = null;
  let transformedMetrics: SpanMetrics | null = null;

  if (input) {
    transformedInput =
      protections.canSeeCapturedInput === true
        ? elasticSearchToTypedValue(input)
        : { type: "text", value: "[REDACTED]" };
  }
  if (output) {
    transformedOutput =
      protections.canSeeCapturedOutput === true
        ? elasticSearchToTypedValue(output)
        : { type: "text", value: "[REDACTED]" };
  }

  if (transformedInput) {
    transformedInput.value = redactObject(transformedInput.value, redactions);
  }
  if (transformedOutput) {
    transformedOutput.value = redactObject(transformedOutput.value, redactions);
  }

  if (metrics) {
    const { cost, ...otherMetrics } = metrics;
    transformedMetrics = otherMetrics;

    if (protections.canSeeCosts === true) {
      transformedMetrics.cost = cost;
    }
  }

  return {
    ...spanFields,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
  };
};

const extractRedactionsFromAllSpanInputs = (spans: ElasticSearchTrace["spans"]): string[] => {
  return (spans || []).flatMap((span) =>
    extractRedactionsForObject(span.input?.value)
  );
};

const extractRedactionsFromAllSpanOutputs = (spans: ElasticSearchTrace["spans"]): string[] => {
  return (spans || []).flatMap((span) =>
    extractRedactionsForObject(span.output?.value)
  );
};

const extractRedactionsForObject = (object: any): string[] => {
  if (typeof object === "string") {
    try {
      const json = JSON.parse(object);
      return extractRedactionsForObject(json);
    } catch (e) {
      const json_ = parsePythonInsideJson(object as any);
      if (typeof json_ === "object") {
        return extractRedactionsForObject(json_);
      }
      return [object];
    }
  }
  if (Array.isArray(object)) {
    return object.flatMap(extractRedactionsForObject) as string[];
  }
  if (typeof object === "object" && object !== null) {
    return Object.values(object).flatMap(
      extractRedactionsForObject
    ) as string[];
  }

  return [];
};

const redactObject = <T>(object: T, redactions: Set<string>): T => {
  if (typeof object === "string") {
    try {
      const json = JSON.parse(object);
      return redactObject(json, redactions);
    } catch (e) {
      const json_ = parsePythonInsideJson(object as any);
      if (typeof json_ === "object") {
        return redactObject(json_, redactions);
      }
      return Array.from(redactions).filter((redaction) => object.includes(redaction))
        .length > 0
        ? ("[REDACTED]" as T)
        : object;
    }
  }
  if (Array.isArray(object)) {
    return object.map((item) => redactObject(item, redactions)) as T;
  }
  if (typeof object === "object" && object !== null) {
    return Object.fromEntries(
      Object.entries(object).map(([key, value]) => [
        key,
        redactObject(value, redactions),
      ])
    ) as T;
  }
  return object;
};
