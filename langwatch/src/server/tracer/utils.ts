import omit from "lodash.omit";
import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "../background/workers/collector/common";
import { extractRAGTextualContext } from "../background/workers/collector/rag";
import {
  type ElasticSearchEvent,
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type Event,
  type ReservedTraceMetadata,
  type Span,
  type SpanInputOutput,
  type Trace,
  type ElasticSearchEvaluation,
  type Evaluation,
} from "./types";
import { reservedTraceMetadataSchema } from "./types.generated";

export const getRAGInfo = (
  spans: ElasticSearchSpan[]
): { input: string; output: string; contexts: string[] } => {
  const sortedSpans = flattenSpanTree(
    organizeSpansIntoTree(spans as Span[]),
    "inside-out"
  ).reverse();
  const lastRagSpan = sortedSpans.find((span) => span.type === "rag") as
    | ElasticSearchSpan
    | undefined;
  if (!lastRagSpan) {
    throw new Error("No 'rag' type span available");
  }

  const contexts = extractRAGTextualContext(lastRagSpan.contexts ?? []);
  if (!lastRagSpan) {
    throw new Error("RAG span does not have contexts");
  }
  if (!lastRagSpan.input) {
    throw new Error("RAG span does not have input");
  }
  if (!lastRagSpan.output) {
    throw new Error("RAG span does not have output");
  }

  let input = typedValueToText(
    elasticSearchToTypedValue(lastRagSpan.input),
    true
  );
  let output = typedValueToText(
    elasticSearchToTypedValue(lastRagSpan.output),
    true
  );

  try {
    input = JSON.parse(input);
    if (typeof input !== "string") {
      input = JSON.stringify(input);
    }
  } catch (e) {}

  try {
    output = JSON.parse(output);
    if (typeof output !== "string") {
      output = JSON.stringify(output);
    }
  } catch (e) {}

  return { input, output, contexts };
};

export const elasticSearchTraceToTrace = (
  elasticSearchTrace: ElasticSearchTrace
): Trace => {
  const metadata = elasticSearchTrace.metadata ?? {};

  const reservedMetadata = Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => key in reservedTraceMetadataSchema.shape
    )
  ) as ReservedTraceMetadata;
  const customMetadata = metadata.custom ?? {};

  return {
    ...omit(elasticSearchTrace, ["events", "evaluations"]),
    metadata: {
      ...reservedMetadata,
      ...customMetadata,
    },
    ...(elasticSearchTrace.events
      ? { events: elasticSearchEventsToEvents(elasticSearchTrace.events) }
      : {}),
    ...(elasticSearchTrace.evaluations
      ? {
          evaluations: elasticSearchEvaluationsToEvaluations(
            elasticSearchTrace.evaluations
          ),
        }
      : {}),
  };
};

export const elasticSearchSpanToSpan = (esSpan: ElasticSearchSpan): Span => {
  const { input, output, ...rest } = esSpan;
  const spanInput: SpanInputOutput | null = input
    ? elasticSearchToTypedValue(input)
    : null;
  const spanOutput: SpanInputOutput | null = output
    ? elasticSearchToTypedValue(output)
    : null;

  return { ...rest, input: spanInput, output: spanOutput };
};

export const elasticSearchToTypedValue = (
  typed: ElasticSearchInputOutput
): SpanInputOutput => {
  try {
    return {
      type: typed.type,
      value:
        typeof typed.value === "string" ? JSON.parse(typed.value) : typed.value,
    } as any;
  } catch (e) {
    return {
      type: "raw",
      value: typed.value,
    };
  }
};

export const elasticSearchEvaluationsToEvaluations = (
  elasticSearchEvaluations: ElasticSearchEvaluation[]
): Evaluation[] => {
  return elasticSearchEvaluations.map((evaluation) => {
    return evaluation;
  });
};

export const elasticSearchEventsToEvents = (
  elasticSearchEvents: ElasticSearchEvent[]
): Event[] => {
  return elasticSearchEvents.map((event) => ({
    ...event,
    metrics: Object.fromEntries(
      event.metrics.map((metric) => [metric.key, metric.value])
    ),
    event_details: Object.fromEntries(
      event.event_details.map((detail) => [detail.key, detail.value])
    ),
  }));
};
