import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "../background/workers/collector/common";
import { extractRAGTextualContext } from "../background/workers/collector/rag";
import {
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type ReservedTraceMetadata,
  type Span,
  type SpanInputOutput,
  type Trace,
  type TraceCheck,
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
    ...elasticSearchTrace,
    metadata: {
      ...reservedMetadata,
      ...customMetadata,
    },
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
      value: JSON.parse(typed.value),
    } as any;
  } catch (e) {
    return {
      type: "raw",
      value: typed.value,
    };
  }
};

export const elasticSearchTraceCheckToUserInterfaceEvaluation = (
  traceCheck: TraceCheck
) => {
  const traceCheck_: Omit<
    TraceCheck,
    "check_id" | "check_name" | "check_type"
  > = {
    ...traceCheck,
  };
  // @ts-ignore
  delete traceCheck_.id;
  // @ts-ignore
  delete traceCheck_.check_id;
  // @ts-ignore
  delete traceCheck_.check_name;
  // @ts-ignore
  delete traceCheck_.check_type;

  return {
    evaluation_id: traceCheck.check_id,
    evaluation_name: traceCheck.check_name,
    evaluation_type: traceCheck.check_type,
    ...traceCheck_,
  };
};
