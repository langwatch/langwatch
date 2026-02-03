import type { Annotation, AnnotationScore, User } from "@prisma/client";
import { z } from "zod";
import { getSpanNameOrModel } from "../../utils/trace";
import { datasetSpanSchema } from "../datasets/types";
import type {
  Trace as BaseTrace,
  DatasetSpan,
  Evaluation,
  Span,
} from "./types";
import { reservedTraceMetadataSchema } from "./types.generated";
import { getRAGChunks, getRAGInfo } from "./utils";

// Define a Trace type that includes annotations for use within this file
// This assumes the Annotation type comes from Prisma
type TraceWithAnnotations = BaseTrace & {
  annotations?: (Annotation & { user?: User | null })[];
};

/**
 * Span subfield type for UI components
 */
export type SpanSubfield = {
  name: string;
  label?: string;
  type: "str" | "dict" | "list";
};

/**
 * Standard span subfields available for mapping.
 * Used by both Online Evaluation and Dataset mapping UIs.
 * Note: "*" is used as a wildcard marker in the path for display purposes.
 */
export const SPAN_SUBFIELDS: SpanSubfield[] = [
  { name: "*", label: "* (full span object)", type: "dict" },
  { name: "input", type: "str" },
  { name: "output", type: "str" },
  { name: "params", type: "dict" },
  { name: "contexts", type: "list" },
];

/**
 * Build span field children for the mapping UI.
 * Returns "* (any span)" (always available) plus dynamic span names from traces.
 *
 * @param spanNames - Dynamic span names extracted from project traces
 * @returns Array of span field children with nested subfields
 */
export function buildSpanFieldChildren(
  spanNames: Array<{ key: string; label: string }>
): Array<{
  name: string;
  label: string;
  type: "dict";
  children: SpanSubfield[];
}> {
  return [
    { name: "*", label: "* (any span)", type: "dict" as const, children: SPAN_SUBFIELDS },
    ...spanNames.map((span) => ({
      name: span.key,
      label: span.label,
      type: "dict" as const,
      children: SPAN_SUBFIELDS,
    })),
  ];
}

/**
 * Reserved metadata keys that are always available.
 */
export const RESERVED_METADATA_KEYS = [
  "thread_id",
  "user_id",
  "customer_id",
  "labels",
  "topic_id",
  "subtopic_id",
];

/**
 * Build metadata field children for the mapping UI.
 * Returns "* (any key)" (always available) plus dynamic metadata keys from traces.
 *
 * @param metadataKeys - Dynamic metadata keys extracted from project traces
 * @returns Array of metadata field children
 */
export function buildMetadataFieldChildren(
  metadataKeys: Array<{ key: string; label: string }>
): Array<{
  name: string;
  label: string;
  type: "str" | "dict" | "list";
}> {
  // Determine type based on key name (labels is a list, others are strings)
  const getTypeForKey = (key: string): "str" | "list" => {
    return key === "labels" ? "list" : "str";
  };

  return [
    { name: "*", label: "* (any key)", type: "str" as const },
    ...metadataKeys.map((meta) => ({
      name: meta.key,
      label: meta.label,
      type: getTypeForKey(meta.key) as "str" | "list",
    })),
  ];
}

export const TRACE_MAPPINGS = {
  trace_id: {
    mapping: (trace: TraceWithAnnotations) => trace.trace_id,
  },
  thread_id: {
    mapping: (trace: TraceWithAnnotations) => trace.metadata?.thread_id ?? "",
  },
  timestamp: {
    mapping: (trace: TraceWithAnnotations) =>
      new Date(trace.timestamps.started_at).toISOString(),
  },
  input: {
    mapping: (trace: TraceWithAnnotations) => trace.input?.value ?? "",
  },
  output: {
    mapping: (trace: TraceWithAnnotations) => trace.output?.value ?? "",
  },
  contexts: {
    mapping: (trace: TraceWithAnnotations) => getRAGChunks(trace.spans ?? []),
  },
  "contexts.string_list": {
    mapping: (trace: TraceWithAnnotations) => {
      try {
        return getRAGInfo(trace.spans ?? []).contexts ?? [];
      } catch {
        return [];
      }
    },
  },
  "metrics.total_cost": {
    mapping: (trace: TraceWithAnnotations) => trace.metrics?.total_cost ?? 0,
  },
  "metrics.first_token_ms": {
    mapping: (trace: TraceWithAnnotations) =>
      trace.metrics?.first_token_ms ?? 0,
  },
  "metrics.total_time_ms": {
    mapping: (trace: TraceWithAnnotations) => trace.metrics?.total_time_ms ?? 0,
  },
  "metrics.prompt_tokens": {
    mapping: (trace: TraceWithAnnotations) => trace.metrics?.prompt_tokens ?? 0,
  },
  "metrics.completion_tokens": {
    mapping: (trace: TraceWithAnnotations) =>
      trace.metrics?.completion_tokens ?? 0,
  },
  "metrics.total_tokens": {
    mapping: (trace: TraceWithAnnotations) =>
      (trace.metrics?.prompt_tokens ?? 0) +
      (trace.metrics?.completion_tokens ?? 0),
  },
  spans: {
    keys: (traces: TraceWithAnnotations[]) => {
      return Array.from(
        new Set(
          traces.flatMap(
            (trace) =>
              trace.spans?.map((span) => getSpanNameOrModel(span)) ?? [],
          ),
        ),
      ).map((key) => ({
        key: key ?? "",
        label: key ?? "",
      }));
    },
    subkeys: (traces: TraceWithAnnotations[], key: string) => {
      const spans = traces
        .flatMap((trace) => trace.spans ?? [])
        .filter((span) => getSpanNameOrModel(span) === key);
      return Object.keys(spans[0] ?? {})
        .filter((key) =>
          ["input", "output", "generated", "params", "contexts"].includes(key),
        )
        .map((key) => ({
          key,
          label: key,
        }));
    },
    mapping: (trace: TraceWithAnnotations, key: string, subkey: string) => {
      const traceSpans = esSpansToDatasetSpans(trace.spans ?? []);
      if (!key) {
        return traceSpans;
      }
      // Handle * as wildcard - return all spans (same as empty key)
      const filteredSpans =
        key === "*"
          ? traceSpans
          : traceSpans.filter(
              (span) => getSpanNameOrModel(span as Span) === key,
            );
      // Handle * as wildcard for subkey - return full span objects
      if (!subkey || subkey === "*") {
        return filteredSpans;
      }
      return filteredSpans.map((span) => span[subkey as keyof DatasetSpan]);
    },
    expandable_by: "spans.all.span_id",
  },
  "spans.llm.input": {
    mapping: (trace: TraceWithAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.input?.value) ?? [],
    expandable_by: "spans.llm.span_id",
  },
  "spans.llm.output": {
    mapping: (trace: TraceWithAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.output?.value) ?? [],
    expandable_by: "spans.llm.span_id",
  },
  metadata: {
    keys: (traces: TraceWithAnnotations[]) => {
      const allKeys = Array.from(
        new Set(traces.flatMap((trace) => Object.keys(trace.metadata ?? {}))),
      );

      const reservedKeys = Object.keys(reservedTraceMetadataSchema.shape);

      const mergedKeys = Array.from(new Set([...allKeys, ...reservedKeys]));

      const excludedKeys = ["custom", "all_keys"];
      const filteredKeys = mergedKeys.filter(
        (key) => !excludedKeys.includes(key),
      );

      // Return all keys, marking reserved ones
      return filteredKeys.map((key) => ({
        key,
        label: reservedKeys.includes(key) ? `${key}` : key,
      }));
    },
    mapping: (trace: TraceWithAnnotations, key: string) => {
      // Handle * as wildcard - return full metadata object
      if (key === "*") {
        return trace.metadata;
      }
      return key ? (trace.metadata?.[key] as any) : JSON.stringify(trace.metadata);
    },
  },
  evaluations: {
    keys: (traces: TraceWithAnnotations[]) => {
      const evaluationsByEvaluatorId = Object.fromEntries(
        traces
          .flatMap((trace) => trace.evaluations ?? [])
          .map((evaluation) => [evaluation.evaluator_id, evaluation]),
      );
      return Object.entries(evaluationsByEvaluatorId).map(
        ([evaluator_id, evaluation]) => ({
          key: evaluator_id,
          label: evaluation.name ?? "",
        }),
      );
    },
    subkeys: (
      traces: TraceWithAnnotations[],
      key: string,
      _data: { annotationScoreOptions?: AnnotationScore[] },
    ) => {
      const evaluation = traces
        .flatMap((trace) => trace.evaluations ?? [])
        .find((evaluation) => evaluation.evaluator_id === key);
      return Object.keys(evaluation ?? {})
        .filter((key) =>
          ["passed", "score", "label", "details", "status", "error"].includes(
            key,
          ),
        )
        .map((key) => ({
          key,
          label: key,
        }));
    },
    mapping: (trace: TraceWithAnnotations, key: string, subkey: string) => {
      if (!key) {
        return trace.evaluations ?? [];
      }
      const evaluation = trace.evaluations?.find(
        (evaluation) => evaluation.evaluator_id === key,
      );
      if (!subkey) {
        return evaluation;
      }
      return evaluation?.[subkey as keyof Evaluation] as string | number;
    },
  },
  annotations: {
    keys: (_traces: TraceWithAnnotations[]) => {
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
      traces: TraceWithAnnotations[],
      key: string,
      data: { annotationScoreOptions?: AnnotationScore[] },
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
      trace: TraceWithAnnotations,
      key: string,
      subkey: string,
      data: { annotationScoreOptions?: AnnotationScore[] },
    ) => {
      if (!key) {
        return trace.annotations ?? [];
      }
      return (trace.annotations ?? []).map((annotation) => {
        if (
          subkey &&
          typeof annotation.scoreOptions === "object" &&
          annotation.scoreOptions !== null
        ) {
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
                data.annotationScoreOptions?.find(
                  (scoreOpt) => scoreOpt.id === key,
                )?.name ?? key,
                score,
              ])
              .filter(([_, scoreValue]) => scoreValue?.value !== null),
          );
        const keyMap = {
          comment: () => annotation.comment,
          is_thumbs_up: () => annotation.isThumbsUp,
          author: () => annotation.user?.name ?? annotation.email ?? "",
          score: scoreOptions,
          "score.reason": scoreOptions,
          expected_output: () => annotation.expectedOutput,
        };
        const func = keyMap[key as keyof typeof keyMap];
        return func ? func() : undefined;
      });
    },
    expandable_by: "annotations.id",
  },
  events: {
    keys: (traces: TraceWithAnnotations[]) => {
      return Array.from(
        new Set(
          traces.flatMap(
            (trace) => trace.events?.flatMap((event) => event.event_type) ?? [],
          ),
        ),
      ).map((key) => ({
        key,
        label: key,
      }));
    },
    subkeys: (traces: TraceWithAnnotations[], key: string) => {
      const events = traces
        .flatMap((trace) => trace.events ?? [])
        .filter((event) => event.event_type === key);

      const eventMetrics = events.flatMap((event) =>
        Object.keys(event.metrics).map((key) => `metrics.${key}`),
      );

      const eventDetails = events.flatMap((event) =>
        Object.keys(event.event_details).map((key) => `event_details.${key}`),
      );

      return Array.from(new Set([...eventMetrics, ...eventDetails])).map(
        (event) => ({
          key: event,
          label: event,
        }),
      );
    },
    mapping: (trace: TraceWithAnnotations, key: string, subkey: string) => {
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
            (event) =>
              event.event_details[subkey.replace("event_details.", "")],
          );
      }
    },
    expandable_by: "events.event_id",
  },
  threads: {
    mapping: (
      trace: TraceWithAnnotations,
      key: string,
      subkey: string,
      data: {
        allTraces?: TraceWithAnnotations[];
        selectedFields?: string[];
      } = {},
    ) => {
      // Return all traces that belong to the same thread_id as the current trace
      const threadId = trace.metadata?.thread_id;
      if (!threadId || !data.allTraces) {
        return [];
      }

      // Filter all traces to find those with the same thread_id
      const threadTraces = data.allTraces.filter(
        (t) => t.metadata?.thread_id === threadId,
      );

      // If selectedFields are provided, extract only those fields from each trace
      if (data.selectedFields && data.selectedFields.length > 0) {
        return threadTraces.map((threadTrace) => {
          const filteredTrace: Record<string, any> = {};
          for (const field of data.selectedFields!) {
            const traceMapping =
              TRACE_MAPPINGS[field as keyof typeof TRACE_MAPPINGS];
            if (traceMapping) {
              filteredTrace[field] = traceMapping.mapping(
                threadTrace,
                "",
                "",
                {},
              );
            } else {
              filteredTrace[field] =
                threadTrace[field as keyof TraceWithAnnotations];
            }
          }
          return filteredTrace;
        });
      }

      // If no selectedFields, return all traces with full data
      return threadTraces;
    },
  },
} satisfies Record<
  string,
  {
    keys?: (traces: TraceWithAnnotations[]) => { key: string; label: string }[];
    subkeys?: (
      traces: TraceWithAnnotations[],
      key: string,
      data: { annotationScoreOptions?: AnnotationScore[] },
    ) => {
      key: string;
      label: string;
    }[];
    mapping:
      | ((
          trace: TraceWithAnnotations,
        ) => string | number | object | undefined | unknown[])
      | ((
          trace: TraceWithAnnotations,
          key: string,
        ) => string | number | object | undefined | unknown[])
      | ((
          trace: TraceWithAnnotations,
          key: string,
          subkey: string,
        ) => string | number | object | undefined | unknown[])
      | ((
          trace: TraceWithAnnotations,
          key: string,
          subkey: string,
          data: { annotationScoreOptions?: AnnotationScore[] },
        ) => string | number | object | undefined | unknown[]);
    expandable_by?: keyof typeof TRACE_EXPANSIONS;
  }
>;

export const TRACE_EXPANSIONS = {
  "spans.llm.span_id": {
    label: "LLM span",
    expansion: (trace: TraceWithAnnotations) => {
      const spans = trace.spans?.filter((span) => span.type === "llm") ?? [];
      return spans.map((span) => ({
        ...trace,
        spans: [span],
      }));
    },
  },
  "spans.all.span_id": {
    label: "all spans",
    expansion: (trace: TraceWithAnnotations) => {
      const spans = trace.spans ?? [];
      return spans.map((span) => ({
        ...trace,
        spans: [span],
      }));
    },
  },
  "annotations.id": {
    label: "annotation",
    expansion: (trace: TraceWithAnnotations) => {
      const annotations = trace.annotations ?? [];
      return annotations.map(
        (annotation: Annotation & { user?: User | null }) => ({
          ...trace,
          annotations: [annotation],
        }),
      );
    },
  },
  "events.event_id": {
    label: "event",
    expansion: (trace: TraceWithAnnotations) => {
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
    expansion: (trace: TraceWithAnnotations) => TraceWithAnnotations[];
  }
>;

/**
 * Extract selected fields from traces based on trace mapping configuration
 * Single Responsibility: Transform traces array into field values based on selectedFields
 */
export const extractTracesFields = (
  traces: TraceWithAnnotations[],
  selectedFields: (keyof typeof TRACE_MAPPINGS)[],
): Record<string, any>[] => {
  return traces.map((trace) => {
    const result: Record<string, any> = {};
    for (const field of selectedFields) {
      const traceMapping = TRACE_MAPPINGS[field];
      if (traceMapping) {
        result[field] = traceMapping.mapping(trace as any, "", "", {});
      }
    }
    return result;
  });
};

/**
 * Thread mappings for grouping traces by thread_id
 * Single Responsibility: Define available mapping options for thread data structure
 */
export const THREAD_MAPPINGS = {
  thread_id: {
    mapping: (thread: { thread_id: string; traces: TraceWithAnnotations[] }) =>
      thread.thread_id,
  },
  traces: {
    mapping: (
      thread: { thread_id: string; traces: TraceWithAnnotations[] },
      selectedFields: (keyof typeof TRACE_MAPPINGS)[] = [],
    ) => extractTracesFields(thread.traces, selectedFields),
  },
} as const;

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
    z.union([
      z
        .object({
          source: z.union([
            z.enum(
              Object.keys(TRACE_MAPPINGS) as [keyof typeof TRACE_MAPPINGS],
            ),
            z.literal(""),
          ]),
          key: z.string().optional(),
          subkey: z.string().optional(),
        })
        .extend({
          type: z.literal("trace").optional(),
        }),
      z
        .object({
          source: z.union([
            z.enum(
              Object.keys(THREAD_MAPPINGS) as [keyof typeof THREAD_MAPPINGS],
            ),
            z.literal(""),
          ]),
          key: z.string().optional(),
          subkey: z.string().optional(),
          selectedFields: z.array(z.string()).optional(),
        })
        .extend({
          type: z.literal("thread"),
        }),
    ]),
  ),
  expansions: z.array(
    z.enum(Object.keys(TRACE_EXPANSIONS) as [keyof typeof TRACE_EXPANSIONS]),
  ),
});

export type MappingState = z.infer<typeof mappingStateSchema>;

/**
 * Thread mapping type used in the wizard UI
 * Single Responsibility: Type definition for thread mapping configuration in the UI
 */
export type ThreadMappingState = {
  mapping: Record<
    string,
    {
      source: keyof typeof THREAD_MAPPINGS | "";
      selectedFields?: string[];
    }
  >;
};

/**
 * Convert thread mappings to unified MappingState format
 * Single Responsibility: Transform thread mappings from wizard format to the unified mapping format
 */
export function convertThreadMappingsToUnified(
  threadMapping: ThreadMappingState,
): MappingState {
  const unifiedMapping: MappingState["mapping"] = {};

  for (const [targetField, { source, selectedFields }] of Object.entries(
    threadMapping.mapping,
  )) {
    if (source) {
      unifiedMapping[targetField] = {
        type: "thread" as const,
        source,
        selectedFields: selectedFields ?? [],
        key: "", // Will be populated dynamically
        subkey: "", // Will be populated dynamically
      };
    }
  }

  return {
    mapping: unifiedMapping,
    expansions: [],
  };
}

/**
 * Merge thread and trace mappings into a single MappingState
 * Single Responsibility: Combine thread and trace mappings, with thread mappings taking precedence
 */
export function mergeThreadAndTraceMappings(
  traceMapping: MappingState | undefined,
  threadMapping: ThreadMappingState | undefined,
  isThreadMapping: boolean,
): MappingState {
  if (!isThreadMapping || !threadMapping) {
    return traceMapping ?? { mapping: {}, expansions: [] };
  }

  const threadMappingConverted = convertThreadMappingsToUnified(threadMapping);

  // Thread mappings take precedence
  return {
    mapping: {
      ...traceMapping?.mapping,
      ...threadMappingConverted.mapping,
    },
    expansions: traceMapping?.expansions ?? [],
  };
}

const esSpansToDatasetSpans = (spans: Span[]): DatasetSpan[] => {
  try {
    return z.array(datasetSpanSchema).parse(spans);
  } catch {
    return spans as any;
  }
};

export const mapTraceToDatasetEntry = (
  trace: TraceWithAnnotations,
  mapping: Record<
    string,
    {
      source: keyof typeof TRACE_MAPPINGS | "";
      key?: string;
      subkey?: string;
      selectedFields?: string[];
    }
  >,
  expansions: Set<keyof typeof TRACE_EXPANSIONS>,
  annotationScoreOptions?: AnnotationScore[],
  allTraces?: TraceWithAnnotations[],
): Record<string, string | number>[] => {
  let expandedTraces: TraceWithAnnotations[] = [trace];

  for (const expansion of expansions) {
    const expanded = expandedTraces.flatMap((trace) =>
      TRACE_EXPANSIONS[expansion].expansion(trace),
    );
    // Only use expanded traces if we found some, otherwise keep original
    expandedTraces = expanded.length > 0 ? expanded : expandedTraces;
  }

  return expandedTraces.map((trace) =>
    Object.fromEntries(
      Object.entries(mapping).map(
        ([column, { source, key, subkey, selectedFields }]) => {
          const source_ =
            source && source in TRACE_MAPPINGS
              ? TRACE_MAPPINGS[source]
              : undefined;

          let value = source_?.mapping(trace, key!, subkey!, {
            annotationScoreOptions,
            allTraces,
            selectedFields,
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
        },
      ),
    ),
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
  type: T,
): StringTypeToType[T] | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (type === "string") {
    return (
      typeof value === "string" ? value : JSON.stringify(value)
    ) as StringTypeToType[T];
  }
  if (type === "number") {
    return Number(value) as StringTypeToType[T];
  }
  if (Array.isArray(value) && type === "string[]") {
    return value.map((v) =>
      tryAndConvertTo(v, "string"),
    ) as unknown as StringTypeToType[T];
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
        if (type === "string[]") {
          return parsed.map((v) =>
            tryAndConvertTo(v, "string"),
          ) as unknown as StringTypeToType[T];
        }
        return parsed as unknown as StringTypeToType[T];
      }
      throw new Error("Failed to parse to a valid type, falling back");
    } catch {
      if (type === "string[]") {
        return [
          tryAndConvertTo(value, "string"),
        ] as unknown as StringTypeToType[T];
      }
      if (type === "array") {
        return [value] as unknown as StringTypeToType[T];
      }
      if (type === "object") {
        return { _json: value } as unknown as StringTypeToType[T];
      }
    }
  }
  return value as unknown as StringTypeToType[T];
};
