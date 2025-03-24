import type { Annotation, AnnotationScore, User } from "@prisma/client";
import { getRAGChunks, getRAGInfo } from "./utils";
import { z } from "zod";
import type {
  DatasetSpan,
  Evaluation,
  Span,
  Trace,
  TraceWithSpans,
} from "./types";
import { datasetSpanSchema } from "./types.generated";
import { getSpanNameOrModel } from "../../utils/trace";

export type TraceWithSpansAndAnnotations = TraceWithSpans & {
  annotations?: (Annotation & {
    user?: User | null;
  })[];
};

export const TRACE_MAPPINGS = {
  trace_id: {
    mapping: (trace: TraceWithSpansAndAnnotations) => trace.trace_id,
  },
  timestamp: {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      new Date(trace.timestamps.started_at).toISOString(),
  },
  input: {
    mapping: (trace: TraceWithSpansAndAnnotations) => trace.input?.value ?? "",
  },
  output: {
    mapping: (trace: TraceWithSpansAndAnnotations) => trace.output?.value ?? "",
  },
  contexts: {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      getRAGChunks(trace.spans ?? []),
  },
  "contexts.string_list": {
    mapping: (trace: TraceWithSpansAndAnnotations) => {
      try {
        return getRAGInfo(trace.spans ?? []).contexts ?? [];
      } catch (e) {
        return [];
      }
    },
  },
  "metrics.total_cost": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.metrics?.total_cost ?? 0,
  },
  "metrics.first_token_ms": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.metrics?.first_token_ms ?? 0,
  },
  "metrics.total_time_ms": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.metrics?.total_time_ms ?? 0,
  },
  "metrics.prompt_tokens": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.metrics?.prompt_tokens ?? 0,
  },
  "metrics.completion_tokens": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.metrics?.completion_tokens ?? 0,
  },
  "metrics.total_tokens": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      (trace.metrics?.prompt_tokens ?? 0) +
      (trace.metrics?.completion_tokens ?? 0),
  },
  spans: {
    keys: (traces: TraceWithSpansAndAnnotations[]) => {
      return Array.from(
        new Set(
          traces.flatMap(
            (trace) =>
              trace.spans?.map((span) => getSpanNameOrModel(span)) ?? []
          )
        )
      ).map((key) => ({
        key: key ?? "",
        label: key ?? "",
      }));
    },
    subkeys: (traces: TraceWithSpansAndAnnotations[], key: string) => {
      const spans = traces
        .flatMap((trace) => trace.spans ?? [])
        .filter((span) => getSpanNameOrModel(span) === key);
      return Object.keys(spans[0] ?? {})
        .filter((key) =>
          ["input", "output", "generated", "params", "contexts"].includes(key)
        )
        .map((key) => ({
          key,
          label: key,
        }));
    },
    mapping: (
      trace: TraceWithSpansAndAnnotations,
      key: string,
      subkey: string
    ) => {
      const traceSpans = esSpansToDatasetSpans(trace.spans ?? []);
      if (!key) {
        return traceSpans;
      }
      const filteredSpans = traceSpans.filter(
        (span) => getSpanNameOrModel(span as Span) === key
      );
      if (!subkey) {
        return filteredSpans;
      }
      return filteredSpans.map((span) => span[subkey as keyof DatasetSpan]);
    },
    expandable_by: "spans.llm.span_id",
  },
  "spans.llm.input": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.input?.value) ?? [],
    expandable_by: "spans.llm.span_id",
  },
  "spans.llm.output": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.output?.value) ?? [],
    expandable_by: "spans.llm.span_id",
  },
  metadata: {
    keys: (traces: TraceWithSpansAndAnnotations[]) =>
      Array.from(
        new Set(traces.flatMap((trace) => Object.keys(trace.metadata ?? {})))
      ).map((key) => ({ key, label: key })),
    mapping: (trace: TraceWithSpansAndAnnotations, key: string) =>
      key ? (trace.metadata?.[key] as any) : JSON.stringify(trace.metadata),
  },
  evaluations: {
    keys: (traces: TraceWithSpansAndAnnotations[]) => {
      const evaluationsByEvaluatorId = Object.fromEntries(
        traces
          .flatMap((trace) => trace.evaluations ?? [])
          .map((evaluation) => [evaluation.evaluator_id, evaluation])
      );
      return Object.entries(evaluationsByEvaluatorId).map(
        ([evaluator_id, evaluation]) => ({
          key: evaluator_id,
          label: evaluation.name ?? "",
        })
      );
    },
    subkeys: (
      traces: TraceWithSpansAndAnnotations[],
      key: string,
      _data: { annotationScoreOptions?: AnnotationScore[] }
    ) => {
      const evaluation = traces
        .flatMap((trace) => trace.evaluations ?? [])
        .find((evaluation) => evaluation.evaluator_id === key);
      return Object.keys(evaluation ?? {})
        .filter((key) =>
          ["passed", "score", "label", "details", "status", "error"].includes(
            key
          )
        )
        .map((key) => ({
          key,
          label: key,
        }));
    },
    mapping: (
      trace: TraceWithSpansAndAnnotations,
      key: string,
      subkey: string
    ) => {
      if (!key) {
        return trace.evaluations ?? [];
      }
      const evaluation = trace.evaluations?.find(
        (evaluation) => evaluation.evaluator_id === key
      );
      if (!subkey) {
        return evaluation;
      }
      return evaluation?.[subkey as keyof Evaluation] as string | number;
    },
  },
  annotations: {
    keys: (_traces: TraceWithSpansAndAnnotations[]) => {
      return [
        "comment",
        "is_thumbs_up",
        "author",
        "score",
        "score.reason",
        "expected_output",
      ].map((key) => ({
        key,
        label: key,
      }));
    },
    subkeys: (
      traces: TraceWithSpansAndAnnotations[],
      key: string,
      data: { annotationScoreOptions?: AnnotationScore[] }
    ) => {
      if (key !== "score" && key !== "score.reason") {
        return [];
      }

      return (data.annotationScoreOptions ?? []).map((option) => ({
        key: option.id,
        label: option.name,
      }));
    },
    mapping: (
      trace: TraceWithSpansAndAnnotations,
      key: string,
      subkey: string,
      data: { annotationScoreOptions?: AnnotationScore[] }
    ) => {
      if (!key) {
        return trace.annotations;
      }
      return trace.annotations?.map((annotation) => {
        if (subkey && typeof annotation.scoreOptions === "object") {
          if (key === "score") {
            return (annotation.scoreOptions as any)[subkey]?.value;
          }
          if (key === "score.reason") {
            return (annotation.scoreOptions as any)[subkey]?.reason;
          }
        }
        const scoreOptions = () =>
          Object.fromEntries(
            Object.entries(annotation.scoreOptions ?? {})
              .map(([key, score]) => [
                data.annotationScoreOptions?.find((score) => score.id === key)
                  ?.name ?? key,
                score,
              ])
              .filter(([_key, score]) => score.value !== null)
          );
        const keyMap = {
          comment: () => annotation.comment,
          is_thumbs_up: () => annotation.isThumbsUp,
          author: () => annotation.user?.name ?? annotation.email ?? "",
          score: scoreOptions,
          "score.reason": scoreOptions,
          expected_output: () => annotation.expectedOutput,
        };
        return keyMap[key as keyof typeof keyMap]();
      });
    },
    expandable_by: "annotations.id",
  },
  events: {
    keys: (traces: TraceWithSpansAndAnnotations[]) => {
      return Array.from(
        new Set(
          traces.flatMap(
            (trace) => trace.events?.flatMap((event) => event.event_type) ?? []
          )
        )
      ).map((key) => ({
        key,
        label: key,
      }));
    },
    subkeys: (traces: TraceWithSpansAndAnnotations[], key: string) => {
      const events = traces
        .flatMap((trace) => trace.events ?? [])
        .filter((event) => event.event_type === key);

      const eventMetrics = events.flatMap((event) =>
        Object.keys(event.metrics).map((key) => `metrics.${key}`)
      );

      const eventDetails = events.flatMap((event) =>
        Object.keys(event.event_details).map((key) => `event_details.${key}`)
      );

      return Array.from(new Set([...eventMetrics, ...eventDetails])).map(
        (event) => ({
          key: event,
          label: event,
        })
      );
    },
    mapping: (
      trace: TraceWithSpansAndAnnotations,
      key: string,
      subkey: string
    ) => {
      if (!key) {
        return trace.events;
      }
      if (!subkey) {
        return trace.events?.filter((event) => event.event_type === key);
      }

      if (subkey.startsWith("metrics.")) {
        return trace.events
          ?.filter((event) => event.event_type === key)
          ?.map((event) => event.metrics[subkey.replace("metrics.", "")]);
      }

      if (subkey.startsWith("event_details.")) {
        return trace.events
          ?.filter((event) => event.event_type === key)
          ?.map(
            (event) => event.event_details[subkey.replace("event_details.", "")]
          );
      }
    },
    expandable_by: "events.event_id",
  },
} satisfies Record<
  string,
  {
    keys?: (
      traces: TraceWithSpansAndAnnotations[]
    ) => { key: string; label: string }[];
    subkeys?: (
      traces: TraceWithSpansAndAnnotations[],
      key: string,
      data: { annotationScoreOptions?: AnnotationScore[] }
    ) => {
      key: string;
      label: string;
    }[];
    mapping:
      | ((
          trace: TraceWithSpansAndAnnotations
        ) => string | number | object | undefined)
      | ((
          trace: TraceWithSpansAndAnnotations,
          key: string
        ) => string | number | object | undefined)
      | ((
          trace: TraceWithSpansAndAnnotations,
          key: string,
          subkey: string
        ) => string | number | object | undefined)
      | ((
          trace: TraceWithSpansAndAnnotations,
          key: string,
          subkey: string,
          data: { annotationScoreOptions?: AnnotationScore[] }
        ) => string | number | object | undefined);
    expandable_by?: keyof typeof TRACE_EXPANSIONS;
  }
>;

export const TRACE_EXPANSIONS = {
  "spans.llm.span_id": {
    label: "LLM span",
    expansion: (trace: TraceWithSpansAndAnnotations) => {
      const spans = trace.spans?.filter((span) => span.type === "llm") ?? [];
      return spans.map((span) => ({
        ...trace,
        spans: [span],
      }));
    },
  },
  "annotations.id": {
    label: "annotation",
    expansion: (trace: TraceWithSpansAndAnnotations) => {
      const annotations = trace.annotations ?? [];
      return annotations.map((annotation) => ({
        ...trace,
        annotations: [annotation],
      }));
    },
  },
  "events.event_id": {
    label: "event",
    expansion: (trace: TraceWithSpansAndAnnotations) => {
      const events = trace.events ?? [];
      return events.map((event) => ({
        ...trace,
        events: [event],
      }));
    },
  },
} satisfies Record<
  string,
  {
    label: string;
    expansion: (
      trace: TraceWithSpansAndAnnotations
    ) => TraceWithSpansAndAnnotations[];
  }
>;

export type TraceMapping = Record<
  string,
  {
    source: keyof typeof TRACE_MAPPINGS | "";
    key?: string;
    subkey?: string;
  }
>;

export const mappingStateSchema = z.object({
  mapping: z.record(
    z.string(),
    z.object({
      source: z.enum(
        Object.keys(TRACE_MAPPINGS) as [keyof typeof TRACE_MAPPINGS | ""]
      ),
      key: z.string().optional(),
      subkey: z.string().optional(),
    })
  ),
  expansions: z.array(
    z.enum(Object.keys(TRACE_EXPANSIONS) as [keyof typeof TRACE_EXPANSIONS])
  ),
});

export type MappingState = z.infer<typeof mappingStateSchema>;

const esSpansToDatasetSpans = (spans: Span[]): DatasetSpan[] => {
  try {
    return z.array(datasetSpanSchema).parse(spans);
  } catch (e) {
    return spans as any;
  }
};

export const mapTraceToDatasetEntry = (
  trace: TraceWithSpansAndAnnotations | Trace,
  mapping: TraceMapping,
  expansions: Set<keyof typeof TRACE_EXPANSIONS>,
  annotationScoreOptions?: AnnotationScore[]
): Record<string, string | number>[] => {
  let expandedTraces: TraceWithSpansAndAnnotations[] = [
    trace as TraceWithSpansAndAnnotations,
  ];

  for (const expansion of expansions) {
    const expanded = expandedTraces.flatMap((trace) =>
      TRACE_EXPANSIONS[expansion].expansion(trace)
    );
    // Only use expanded traces if we found some, otherwise keep original
    expandedTraces = expanded.length > 0 ? expanded : expandedTraces;
  }

  return expandedTraces.map((trace) =>
    Object.fromEntries(
      Object.entries(mapping).map(([column, { source, key, subkey }]) => {
        const source_ = source ? TRACE_MAPPINGS[source] : undefined;

        let value = source_?.mapping(trace, key!, subkey!, {
          annotationScoreOptions,
        });

        if (
          source_ &&
          "expandable_by" in source_ &&
          source_?.expandable_by &&
          expansions.has(source_?.expandable_by)
        ) {
          value = value?.[0];
        }

        return [
          column,
          typeof value !== "string" && typeof value !== "number"
            ? JSON.stringify(value)
            : value,
        ];
      })
    )
  );
};

type StringTypeToType = {
  string: string;
  number: number;
  "string[]": string[];
  object: Record<string, any>;
  array: any[];
};

export const tryAndConvertTo = <T extends keyof StringTypeToType>(
  value: any,
  type: T
): StringTypeToType[T] | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (type === "string") {
    return value.toString();
  }
  if (type === "number") {
    return Number(value) as StringTypeToType[T];
  }
  if (
    typeof value === "string" &&
    (type === "object" || type === "string[]" || type === "array")
  ) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) && typeof parsed === "object") {
        return parsed as unknown as StringTypeToType[T];
      }
      if (Array.isArray(parsed)) {
        return parsed as unknown as StringTypeToType[T];
      }
      throw new Error("Failed to parse to a valid type, falling back");
    } catch (e) {
      if (type === "string[]") {
        return [value.toString()] as unknown as StringTypeToType[T];
      }
      if (type === "array") {
        return [value.toString()] as unknown as StringTypeToType[T];
      }
      if (type === "object") {
        return { _json: value } as unknown as StringTypeToType[T];
      }
    }
  }
  return value as unknown as StringTypeToType[T];
};
