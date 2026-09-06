import { z } from "zod";
import type { Annotation, AnnotationScore } from "~/generated/prisma/client";
import { getSpanNameOrModel } from "../../utils/trace";
import {
  type AnnotationAnchorRef,
  describeAnnotationAnchor,
} from "../annotations/annotationAnchorLabel";
import { annotationSuggestedOutput } from "../annotations/annotationSuggestedOutput";
import { datasetSpanSchema } from "../datasets/types";
import {
  type Trace as BaseTrace,
  type DatasetSpan,
  type Evaluation,
  reservedTraceMetadataSchema,
  type Span,
} from "./types";
import { getRAGChunks, getRAGInfo } from "./utils";

// Define a Trace type that includes annotations for use within this file
// This assumes the Annotation type comes from Prisma.
//
// `user` asks for only the field this file reads (`author` uses `user.name`).
// Requiring the whole Prisma `User` forced every caller to fetch every user
// column — email, lastLoginAt and the rest — just to satisfy the type, which
// is how those columns ended up being shipped to the browser.
type TraceWithAnnotations = BaseTrace & {
  annotations?: (Annotation & {
    user?: { name?: string | null } | null;
  })[];
};

/** One reviewer's annotation as this file reads it. */
export type TraceAnnotation = NonNullable<
  TraceWithAnnotations["annotations"]
>[number];

/** One scoreOptions entry, as the annotation router writes it. */
type AnnotationScoreOption = {
  value?: string | string[] | null;
  reason?: string | null;
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
  spanNames: Array<{ key: string; label: string }>,
): Array<{
  name: string;
  label: string;
  type: "dict";
  children: SpanSubfield[];
}> {
  return [
    {
      name: "*",
      label: "* (any span)",
      type: "dict" as const,
      children: SPAN_SUBFIELDS,
    },
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
  metadataKeys: Array<{ key: string; label: string }>,
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

function filterThreadTraces(
  trace: TraceWithAnnotations,
  data: { allTraces?: TraceWithAnnotations[]; selectedFields?: string[] },
  extraFilter?: (t: TraceWithAnnotations) => boolean,
): TraceWithAnnotations[] | Record<string, unknown>[] {
  const threadId = trace.metadata?.thread_id;
  if (!threadId || !data.allTraces) {
    return [];
  }

  let threadTraces = data.allTraces
    .filter((t) => t.metadata?.thread_id === threadId)
    .sort((a, b) => a.timestamps.started_at - b.timestamps.started_at);
  if (extraFilter) {
    threadTraces = threadTraces.filter(extraFilter);
  }

  if (data.selectedFields && data.selectedFields.length > 0) {
    return threadTraces.map((threadTrace) => {
      const filteredTrace: Record<string, unknown> = {};
      for (const field of data.selectedFields!) {
        const traceMapping =
          TRACE_MAPPINGS[field as keyof typeof TRACE_MAPPINGS];
        if (traceMapping) {
          filteredTrace[field] = traceMapping.mapping(threadTrace, "", "", {});
        } else {
          filteredTrace[field] =
            threadTrace[field as keyof TraceWithAnnotations];
        }
      }
      return filteredTrace;
    });
  }

  return threadTraces;
}

/** Collapses any run of whitespace, so a value written over several lines still reads as one. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The name each span answers to, by its id, for naming the part a comment is about. */
const buildSpanNameIndex = (
  spans: Span[],
): Map<string, string | null | undefined> =>
  new Map(spans.map((span) => [span.span_id, getSpanNameOrModel(span)]));

/** A score's value as it reads: a multi-select answers with several, joined. */
const readableScoreValue = (value: AnnotationScoreOption["value"]): string => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => oneLine(String(entry)))
      .filter(Boolean)
      .join(", ");
  }
  if (value === null || value === undefined) return "";
  return oneLine(String(value));
};

/**
 * The scores a reviewer answered, each as `[name: value]`, or
 * `[name: value, reason: why]` when they said why. A score they left blank is
 * not one of their answers, so it does not read at all.
 */
const readableScoreParts = ({
  scoreOptions,
  projectScores,
}: {
  scoreOptions: TraceAnnotation["scoreOptions"];
  projectScores?: AnnotationScore[];
}): string[] => {
  if (
    typeof scoreOptions !== "object" ||
    scoreOptions === null ||
    Array.isArray(scoreOptions)
  ) {
    return [];
  }

  const parts: string[] = [];
  for (const [scoreId, score] of Object.entries(
    scoreOptions as Record<string, AnnotationScoreOption | null>,
  )) {
    const value = readableScoreValue(score?.value);
    if (!value) continue;
    const name =
      projectScores?.find((option) => option.id === scoreId)?.name ?? scoreId;
    const reason = oneLine(score?.reason ?? "");
    parts.push(
      reason ? `[${name}: ${value}, reason: ${reason}]` : `[${name}: ${value}]`,
    );
  }
  return parts;
};

/**
 * What a comment is about, named for a reader who is not looking at the trace:
 * `web_search span (0af31b2c) · Output`, `Trace (95bf974e) · Output`. Null when
 * it is about the trace as a whole. */
const readableAnnotationPart = ({
  annotation,
  traceId,
  spanNamesById,
}: {
  annotation: TraceAnnotation;
  traceId: string;
  spanNamesById?: Map<string, string | null | undefined>;
}): string | null => {
  const anchor: AnnotationAnchorRef = {
    anchorKind: annotation.anchorKind as AnnotationAnchorRef["anchorKind"],
    anchorId: annotation.anchorId,
    anchorPath: annotation.anchorPath,
  };
  return describeAnnotationAnchor({
    anchor,
    traceId,
    spanName: annotation.anchorId
      ? spanNamesById?.get(annotation.anchorId)
      : undefined,
    withIds: true,
  });
};

/** Who left the comment: their name, their email if they have no name, "Unknown" if neither. */
const readableAnnotationAuthor = (annotation: TraceAnnotation): string =>
  oneLine(annotation.user?.name ?? annotation.email ?? "") || "Unknown";

/**
 * Who left the comment and what it is about: `Ada`, or
 * `Ada (on web_search span (0af31b2c) · Output)` when they left it on a part of
 * the trace.
 */
const readableAnnotationHead = ({
  annotation,
  traceId,
  spanNamesById,
}: {
  annotation: TraceAnnotation;
  traceId: string;
  spanNamesById?: Map<string, string | null | undefined>;
}): string => {
  const part = readableAnnotationPart({ annotation, traceId, spanNamesById });
  const author = readableAnnotationAuthor(annotation);
  return part ? `${author} (on ${part})` : author;
};

/**
 * What a suggestion left with a comment is a suggestion FOR, in words. A
 * comment on an input asks for a different input; everything else, including a
 * comment about the whole trace, asks for a different output.
 */
const suggestionLabel = (annotation: TraceAnnotation): string =>
  annotation.anchorKind === "field" && annotation.anchorPath === "input"
    ? "suggested input"
    : "suggested output";

/**
 * One reviewer's annotation as a single line anyone can read, a person or an
 * LLM judge, without knowing how we store annotations:
 *
 *   <author>[ (on <part of the trace>)][: <comment>][ [thumbs up|thumbs down]]
 *   [ [<score name>: <value>[, reason: <reason>]]]...[ [suggested output: <text>]]
 *
 * Each part after the author appears only when the reviewer left it, so a bare
 * comment reads `Ada: too terse` and a bare rating reads `Ada [thumbs down]`.
 * A reviewer with no account name reads by their email, and by "Unknown" when
 * we have neither. A score with no value is left out; its name is the one the
 * project gave it, never its id. A suggestion on an input reads as a suggested
 * input rather than a suggested output, so the line says what was asked for.
 */
export function buildReadableAnnotation({
  annotation,
  traceId,
  spanNamesById,
  scoreOptions,
}: {
  annotation: TraceAnnotation;
  traceId: string;
  spanNamesById?: Map<string, string | null | undefined>;
  scoreOptions?: AnnotationScore[];
}): string {
  const head = readableAnnotationHead({ annotation, traceId, spanNamesById });
  const comment = oneLine(annotation.comment ?? "");
  const parts: string[] = [comment ? `${head}: ${comment}` : head];

  if (typeof annotation.isThumbsUp === "boolean") {
    parts.push(`[${annotation.isThumbsUp ? "thumbs up" : "thumbs down"}]`);
  }

  parts.push(
    ...readableScoreParts({
      scoreOptions: annotation.scoreOptions,
      projectScores: scoreOptions,
    }),
  );

  const suggestion = oneLine(annotation.expectedOutput ?? "");
  if (suggestion) {
    parts.push(`[${suggestionLabel(annotation)}: ${suggestion}]`);
  }

  return parts.join(" ");
}

/**
 * The scores a reviewer answered, keyed by the name the project gave each one
 * rather than its id. A score they left blank is not an answer, so it is left
 * out.
 */
const namedScoreOptions = ({
  scoreOptions,
  projectScores,
}: {
  scoreOptions: TraceAnnotation["scoreOptions"];
  projectScores?: AnnotationScore[];
}): Record<string, AnnotationScoreOption> => {
  if (
    typeof scoreOptions !== "object" ||
    scoreOptions === null ||
    Array.isArray(scoreOptions)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scoreOptions as Record<string, AnnotationScoreOption | null>)
      .filter(([_, score]) => score && score.value !== null)
      .map(([scoreId, score]) => [
        projectScores?.find((option) => option.id === scoreId)?.name ?? scoreId,
        score as AnnotationScoreOption,
      ]),
  );
};

/**
 * One reviewer's annotation as a record, carrying the same things the single
 * columns carry and under the same names: who wrote it, what part of the trace
 * it is about, the comment, the rating, the scores by name and the suggestion.
 *
 * Only what the reviewer actually left is in it. A row that says
 * `"is_thumbs_up": null, "expected_output": null` tells the reader nothing
 * except that our schema has those columns, and an LLM judge reading the row
 * has to spend attention deciding they mean nothing. Our storage shape stays
 * out of it too: no ids of ours, no `email` field standing in for the author.
 */
export function buildAnnotationRecord({
  annotation,
  traceId,
  spanNamesById,
  scoreOptions,
}: {
  annotation: TraceAnnotation;
  traceId: string;
  spanNamesById?: Map<string, string | null | undefined>;
  scoreOptions?: AnnotationScore[];
}): Record<string, unknown> {
  const part = readableAnnotationPart({ annotation, traceId, spanNamesById });
  const comment = oneLine(annotation.comment ?? "");
  const scores = namedScoreOptions({
    scoreOptions: annotation.scoreOptions,
    projectScores: scoreOptions,
  });
  const suggestion = oneLine(annotation.expectedOutput ?? "");
  const suggestionKey =
    suggestionLabel(annotation) === "suggested input"
      ? "suggested_input"
      : "expected_output";
  const createdAt = new Date(annotation.createdAt);

  return {
    author: readableAnnotationAuthor(annotation),
    ...(part ? { on: part } : {}),
    ...(comment ? { comment } : {}),
    ...(typeof annotation.isThumbsUp === "boolean"
      ? { is_thumbs_up: annotation.isThumbsUp }
      : {}),
    ...(Object.keys(scores).length > 0 ? { score: scores } : {}),
    ...(suggestion ? { [suggestionKey]: suggestion } : {}),
    ...(Number.isNaN(createdAt.getTime())
      ? {}
      : { created_at: createdAt.toISOString() }),
  };
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
      return Object.keys(spans[0] || {})
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
        new Set(traces.flatMap((trace) => Object.keys(trace.metadata || {}))),
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
      return key
        ? (trace.metadata?.[key] as any)
        : JSON.stringify(trace.metadata);
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
      return Object.keys(evaluation || {})
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
        "ai_readable",
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
      const annotations = trace.annotations ?? [];
      const spanNamesById =
        !key || key === "ai_readable"
          ? buildSpanNameIndex(trace.spans ?? [])
          : undefined;

      if (!key) {
        return annotations.map((annotation) =>
          buildAnnotationRecord({
            annotation,
            traceId: trace.trace_id,
            spanNamesById,
            scoreOptions: data.annotationScoreOptions,
          }),
        );
      }

      // Everything said about the trace, as one text rather than a list of
      // them: the column exists to be read, and a reader handed
      // `["Ada: too terse","Bo: fine"]` reads JSON before they read the review.
      // A rule between reviews tells one from the next at a glance, for a
      // person as much as for a judge; a single review carries none.
      if (key === "ai_readable") {
        return annotations
          .map((annotation) =>
            buildReadableAnnotation({
              annotation,
              traceId: trace.trace_id,
              spanNamesById,
              scoreOptions: data.annotationScoreOptions,
            }),
          )
          .join("\n---\n");
      }

      return annotations.map((annotation) => {
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
          namedScoreOptions({
            scoreOptions: annotation.scoreOptions,
            projectScores: data.annotationScoreOptions,
          });
        const keyMap = {
          comment: () => annotation.comment,
          is_thumbs_up: () => annotation.isThumbsUp,
          author: () => annotation.user?.name ?? annotation.email ?? "",
          score: scoreOptions,
          "score.reason": scoreOptions,
          expected_output: () =>
            annotationSuggestedOutput({
              annotation,
              traceId: trace.trace_id,
            }),
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
      _key: string,
      _subkey: string,
      data: {
        allTraces?: TraceWithAnnotations[];
        selectedFields?: string[];
      } = {},
    ) => filterThreadTraces(trace, data),
  },
  threads_until_current: {
    mapping: (
      trace: TraceWithAnnotations,
      _key: string,
      _subkey: string,
      data: {
        allTraces?: TraceWithAnnotations[];
        selectedFields?: string[];
      } = {},
    ) =>
      filterThreadTraces(trace, data, (t) => {
        return t.timestamps.started_at <= trace.timestamps.started_at;
      }),
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

/**
 * Whether mapping a source turns its expansion on for you.
 *
 * A trace has one annotation or a handful, so expanding them reads as the point
 * of mapping them at all. It has as many spans as it has work, and a dataset
 * built from them is a row per trace until someone says otherwise, so the span
 * expansions are opt-in.
 */
export const TRACE_EXPANSIONS = {
  "spans.llm.span_id": {
    label: "LLM span",
    enabledByDefault: false,
    expansion: (trace: TraceWithAnnotations) => {
      const spans = trace.spans?.filter((span) => span.type === "llm") ?? [];
      return spans.map((span) => ({
        ...trace,
        spans: [span],
      }));
    },
  },
  "spans.all.span_id": {
    label: "span",
    enabledByDefault: false,
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
    enabledByDefault: true,
    expansion: (trace: TraceWithAnnotations) => {
      const annotations = trace.annotations ?? [];
      return annotations.map((annotation) => ({
        ...trace,
        annotations: [annotation],
      }));
    },
  },
  "events.event_id": {
    label: "event",
    enabledByDefault: true,
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
    enabledByDefault: boolean;
    expansion: (trace: TraceWithAnnotations) => TraceWithAnnotations[];
  }
>;

/**
 * Extract selected fields from traces based on trace mapping configuration
 * Single Responsibility: Transform traces array into field values based on selectedFields
 */
const DEFAULT_TRACE_FIELDS: (keyof typeof TRACE_MAPPINGS)[] = [
  "trace_id",
  "input",
  "output",
];

export const extractTracesFields = (
  traces: TraceWithAnnotations[],
  selectedFields: (keyof typeof TRACE_MAPPINGS)[],
): Record<string, any>[] => {
  // When no fields are selected, extract default fields so the data is useful
  const fields =
    selectedFields.length > 0 ? selectedFields : DEFAULT_TRACE_FIELDS;
  return traces.map((trace) => {
    const result: Record<string, any> = {};
    for (const field of fields) {
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

/**
 * Additional mapping source keys that are only executed server-side (e.g. in the evaluations worker).
 * They appear in the UI and schema but their implementations live outside this shared module
 * to avoid pulling Node.js-only dependencies into the frontend bundle.
 */
export const SERVER_ONLY_TRACE_SOURCES = ["formatted_trace"] as const;
export const SERVER_ONLY_THREAD_SOURCES = ["formatted_traces"] as const;

export type AllTraceMappingSources =
  | keyof typeof TRACE_MAPPINGS
  | (typeof SERVER_ONLY_TRACE_SOURCES)[number];

export type AllThreadMappingSources =
  | keyof typeof THREAD_MAPPINGS
  | (typeof SERVER_ONLY_THREAD_SOURCES)[number];

export const mappingStateSchema = z.object({
  mapping: z.record(
    z.string(),
    z.union([
      z
        .object({
          source: z.union([
            z.enum([
              ...(Object.keys(TRACE_MAPPINGS) as [keyof typeof TRACE_MAPPINGS]),
              ...SERVER_ONLY_TRACE_SOURCES,
            ]),
            z.literal(""),
          ]),
          key: z.string().optional(),
          subkey: z.string().optional(),
          selectedFields: z.array(z.string()).optional(),
        })
        .extend({
          type: z.literal("trace").optional(),
        }),
      z
        .object({
          source: z.union([
            z.enum([
              ...(Object.keys(THREAD_MAPPINGS) as [
                keyof typeof THREAD_MAPPINGS,
              ]),
              ...SERVER_ONLY_THREAD_SOURCES,
            ]),
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

// Coerces legacy `{}` and other partial-shape payloads into a valid MappingState
// before persisting. Without this, monitors created via API with `mappings: {}`
// end up missing the `.mapping` subkey, which crashes downstream evaluator code
// at `Object.values(mappingState.mapping)` (see threadMappingResolver.ts). The
// read-side guard there is defensive; this is the canonical write-side fix.
//
// Using z.preprocess (vs z.unknown().transform().pipe()) so hono-openapi can
// infer the output type from the inner mappingStateSchema for the OpenAPI spec.
export const monitorMappingsSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    "mapping" in (value as object)
  ) {
    return value;
  }
  return { mapping: {}, expansions: [] };
}, mappingStateSchema.nullable().optional());

// Runtime equivalent of monitorMappingsSchema for callers that don't validate
// through Zod (e.g. internal tRPC routes that consume already-typed input).
// Coerces null/undefined/malformed shapes into a canonical empty MappingState
// so the persist layer never writes the `{}` shape that triggers the
// `Object.values(undefined)` crash in evaluator code paths.
export const coerceMonitorMappings = (value: unknown): MappingState => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "mapping" in (value as object)
  ) {
    const parsed = mappingStateSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return { mapping: {}, expansions: [] };
};

/**
 * Thread mapping type used in the wizard UI
 * Single Responsibility: Type definition for thread mapping configuration in the UI
 */
export type ThreadMappingState = {
  mapping: Record<
    string,
    {
      source: AllThreadMappingSources | "";
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
      source: string;
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
              ? TRACE_MAPPINGS[source as keyof typeof TRACE_MAPPINGS]
              : undefined;

          let value = source_?.mapping(trace, key!, subkey!, {
            annotationScoreOptions,
            allTraces,
            selectedFields,
          });

          // An expanded trace holds exactly one of whatever it was expanded by,
          // so a column that lists them holds one entry: take it out of the
          // list. A column that already reads as one value, the annotations
          // read as a single text, is that value; indexing it would take its
          // first character.
          if (
            source_ &&
            "expandable_by" in source_ &&
            source_?.expandable_by &&
            expansions.has(source_?.expandable_by) &&
            Array.isArray(value)
          ) {
            value = value[0];
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

// Returns the unwrapped .value if v is an OTel typed-object wrapper ({ type, value } with exactly
// those two own keys and a string type). Returns undefined to signal "no unwrap needed" — this
// lets null/0/false/etc. pass through correctly as unwrapped values.
const unwrapTypedObject = (v: unknown): unknown => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  if (!("type" in v) || !("value" in v)) return undefined;
  if (Object.keys(v as object).length !== 2) return undefined;
  const obj = v as { type: unknown; value: unknown };
  if (typeof obj.type !== "string") return undefined;
  return obj.value;
};

export const tryAndConvertTo = <T extends keyof StringTypeToType>(
  value: any,
  type: T,
): StringTypeToType[T] | undefined => {
  // Unwrap OTel typed-object wrappers first so downstream coercion sees the bare value.
  // OTel SDK auto-wraps span IO as { type: <string>, value: <any> }; evaluators need bare values. (#3875)
  const unwrapped = unwrapTypedObject(value);
  if (unwrapped !== undefined) value = unwrapped;
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

// ============================================================================
// Available Sources for Mapping UI
// ============================================================================

/**
 * Type for available sources in the mapping UI.
 * Matches the AvailableSource type from VariableMappingInput.
 */
export type TraceAvailableSource = {
  id: string;
  name: string;
  type: "dataset";
  fields: Array<{
    name: string;
    label?: string;
    type: "str" | "dict" | "list";
    children?: Array<{
      name: string;
      label?: string;
      type: "str" | "dict" | "list";
      children?: SpanSubfield[];
    }>;
    isComplete?: boolean;
    isCompleteLabel?: string;
  }>;
};

/**
 * Static children for thread traces field.
 * These are the common trace fields that can be extracted from each trace in a thread.
 */
const THREAD_TRACES_CHILDREN = [
  { name: "input", type: "str" as const },
  { name: "output", type: "str" as const },
  { name: "contexts", type: "list" as const },
  { name: "timestamp", type: "str" as const },
  { name: "trace_id", type: "str" as const },
];

/**
 * Human-readable labels for trace mapping sources.
 * Keys not listed here will use their key name as the label.
 */
export const TRACE_MAPPING_LABELS: Record<string, string | undefined> = {
  formatted_trace: "Full Trace (AI-Readable)",
  threads: "all traces",
  threads_until_current: "traces until now",
  thread_id: "thread_id",
};

/**
 * Human-readable labels for thread mapping sources.
 * Keys not listed here will use their key name as the label.
 */
export const THREAD_MAPPING_LABELS: Record<string, string | undefined> = {
  formatted_traces: "Full Thread (AI-Readable)",
};

/**
 * Convert TRACE_MAPPINGS to AvailableSource format for the mapping UI.
 * Provides dynamic children for metadata and spans based on project traces.
 *
 * @param spanNames - Dynamic span names extracted from project traces
 * @param metadataKeys - Dynamic metadata keys extracted from project traces
 */
export function getTraceAvailableSources(
  spanNames: Array<{ key: string; label: string }>,
  metadataKeys: Array<{ key: string; label: string }>,
): TraceAvailableSource[] {
  // Filter out "threads" from trace-level sources - it's confusing at trace level
  // (threads is for getting all traces in a thread, which is a thread-level concept)
  const traceFields: TraceAvailableSource["fields"] = [
    // Server-only trace sources at the top for discoverability
    ...SERVER_ONLY_TRACE_SOURCES.map((source) => ({
      name: source,
      label: TRACE_MAPPING_LABELS[source],
      type: "str" as const,
    })),
    ...Object.entries(TRACE_MAPPINGS)
      .filter(([key]) => key !== "threads" && key !== "threads_until_current")
      .map(([key, config]) => {
        const hasKeys = "keys" in config && typeof config.keys === "function";

        // Provide dynamic children for metadata
        if (key === "metadata") {
          return {
            name: key,
            type: "dict" as const,
            // Use dynamic metadata keys with "* (any key)" always available
            children: buildMetadataFieldChildren(metadataKeys),
            // Allow selecting metadata itself (returns full metadata object)
            isComplete: true,
            isCompleteLabel: "All metadata",
          };
        }

        if (key === "spans") {
          return {
            name: key,
            type: "list" as const,
            // Use dynamic span names with "* (any span)" always available
            children: buildSpanFieldChildren(spanNames),
            // Allow selecting spans itself (returns all spans array)
            isComplete: true,
            isCompleteLabel: "Full spans array",
          };
        }

        // Other fields with keys() function - mark as complete (no nested selection needed)
        if (hasKeys) {
          return {
            name: key,
            type: "dict" as const,
            isComplete: true,
          };
        }

        return {
          name: key,
          type: "str" as const,
        };
      }),
  ];

  return [
    {
      id: "trace",
      name: "Current Trace",
      type: "dataset",
      fields: traceFields,
    },
    // Include thread sources at trace level so evaluators can access
    // full thread context even when triggered per-trace
    ...getThreadAvailableSources(),
  ];
}

/**
 * Convert THREAD_MAPPINGS to AvailableSource format for the mapping UI.
 */
export function getThreadAvailableSources(): TraceAvailableSource[] {
  return [
    {
      id: "thread",
      name: "Current Thread",
      type: "dataset",
      fields: [
        // Server-only thread sources at the top for discoverability
        ...SERVER_ONLY_THREAD_SOURCES.map((source) => ({
          name: source,
          label: THREAD_MAPPING_LABELS[source],
          type: "str" as const,
        })),
        ...Object.entries(THREAD_MAPPINGS)
          .filter(([key]) => key !== "traces")
          .map(([key, config]) => {
            const hasKeys =
              "keys" in config && typeof config.keys === "function";

            if (hasKeys) {
              return {
                name: key,
                type: "dict" as const,
                isComplete: true,
              };
            }

            return {
              name: key,
              type: "str" as const,
            };
          }),
        {
          name: "traces",
          type: "list" as const,
          children: THREAD_TRACES_CHILDREN,
          isComplete: true,
        },
      ],
    },
  ];
}
