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

export const esSpansToDatasetSpans = (spans: Span[]): DatasetSpan[] => {
  try {
    return z.array(datasetSpanSchema).parse(spans);
  } catch (e) {
    return spans as unknown as DatasetSpan[];
  }
};

export const transformElasticSearchTraceToTrace = (
  elasticSearchTrace: ElasticSearchTrace,
  protections: Protections,
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
  const customMetadata = metadata.custom ?? {};

  let transformedEvents: Event[] = [];
  let transformedEvaluations: Evaluation[] = [];
  let transformedSpans: Span[] = [];

  let transformedInput: TraceInput | undefined = void 0;
  let transformedOutput: TraceOutput | undefined = void 0;
  let transformedMetrics: Trace['metrics'] | undefined = void 0;

  if (input && protections.canSeeCapturedInput === true) {
    transformedInput = input;
  }
  if (output && protections.canSeeCapturedOutput === true) {
    transformedOutput = output;
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
      transformedSpans.push(transformElasticSearchSpanToSpan(span, protections));
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

export const transformElasticSearchSpanToSpan = (esSpan: ElasticSearchSpan, protections: Protections): Span => {
  const { input, output, metrics, ...spanFields } = esSpan;

  let transformedInput: SpanInputOutput | null = null;
  let transformedOutput: SpanInputOutput | null = null;
  let transformedMetrics: SpanMetrics | null = null;

  if (input && protections.canSeeCapturedInput === true) {
    transformedInput = elasticSearchToTypedValue(input);
  }
  if (output && protections.canSeeCapturedOutput === true) {
    transformedOutput = elasticSearchToTypedValue(output);
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
