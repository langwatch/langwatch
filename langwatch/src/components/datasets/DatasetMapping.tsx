import { Box, HStack, Select, Spacer, Text, VStack } from "@chakra-ui/react";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown } from "react-feather";
import { z } from "zod";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import type {
  DatasetSpan,
  Evaluation,
  Span,
  TraceWithSpans,
} from "../../server/tracer/types";
import { datasetSpanSchema } from "../../server/tracer/types.generated";
import { getRAGChunks, getRAGInfo } from "../../server/tracer/utils";
import { useLocalStorage } from "usehooks-ts";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Annotation, User } from "@prisma/client";

type TraceWithSpansAndAnnotations = TraceWithSpans & {
  annotations?: (Annotation & { user?: User | null })[];
};

const TRACE_MAPPINGS = {
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
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      esSpansToDatasetSpans(trace.spans ?? []),
  },
  "spans.llm.input": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.input?.value) ?? [],
    expandable_by: "spans.span_id",
  },
  "spans.llm.output": {
    mapping: (trace: TraceWithSpansAndAnnotations) =>
      trace.spans
        ?.filter((span) => span.type === "llm")
        ?.map((span) => span.output?.value) ?? [],
    expandable_by: "spans.span_id",
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
    subkeys: (traces: TraceWithSpansAndAnnotations[], key: string) => {
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
    keys: (traces: TraceWithSpansAndAnnotations[]) => {
      // TODO: add score
      return ["comment", "is_thumbs_up", "author"].map((key) => ({
        key,
        label: key,
      }));
    },
    mapping: (trace: TraceWithSpansAndAnnotations, key: string) => {
      if (!key) {
        return trace.annotations;
      }
      return trace.annotations?.map((annotation) => {
        const keyMap = {
          comment: () => annotation.comment,
          is_thumbs_up: () => annotation.isThumbsUp,
          author: () => annotation.user?.name ?? annotation.email ?? "",
        };
        return keyMap[key as keyof typeof keyMap]();
      });
    },
    expandable_by: "annotations.id",
  },
} satisfies Record<
  string,
  {
    keys?: (
      traces: TraceWithSpansAndAnnotations[]
    ) => { key: string; label: string }[];
    subkeys?: (
      traces: TraceWithSpansAndAnnotations[],
      key: string
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
        ) => string | number | object | undefined);
    expandable_by?: "spans.span_id" | "annotations.id";
  }
>;

const DATASET_INFERRED_MAPPINGS_BY_NAME: Record<
  string,
  keyof typeof TRACE_MAPPINGS
> = {
  trace_id: "trace_id",
  timestamp: "timestamp",
  input: "input",
  output: "output",
  expected_output: "output",
  total_cost: "metrics.total_cost",
  contexts: "contexts.string_list",
  spans: "spans",
};

type Mapping = Record<
  string,
  {
    source: keyof typeof TRACE_MAPPINGS | "";
    key?: string;
    subkey?: string;
  }
>;

export const TracesMapping = ({
  traces,
  columnTypes,
  setDatasetEntries,
}: {
  traces: TraceWithSpans[];
  columnTypes?: DatasetColumns;
  setDatasetEntries: (entries: DatasetRecordEntry[]) => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const annotationScores = api.annotation.getByTraceIds.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traces.map((trace) => trace.trace_id),
    },
    { enabled: !!project, refetchOnWindowFocus: false }
  );
  const getAnnotationScoreOptions = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    }
  );
  const traces_ = traces.map((trace) => ({
    ...trace,
    annotations: annotationScores.data?.filter(
      (annotation) => annotation.traceId === trace.trace_id
    ),
  }));

  const [mapping, setMapping] = useState<Mapping>({});
  const [localStorageMapping, setLocalStorageMapping] =
    useLocalStorage<Mapping>("datasetMapping", {});

  const now = useMemo(() => new Date().getTime(), []);

  useEffect(() => {
    setMapping(
      Object.fromEntries(
        columnTypes?.map(({ name }) => [
          name,
          localStorageMapping[name] ?? {
            source: DATASET_INFERRED_MAPPINGS_BY_NAME[name] ?? "",
          },
        ]) ?? []
      )
    );
  }, [columnTypes]);

  useEffect(() => {
    setLocalStorageMapping(mapping);
    setDatasetEntries(
      traces_.map((trace, index) => {
        return {
          id: `${now}-${index}`,
          selected: true,
          ...Object.fromEntries(
            Object.entries(mapping).map(([column, { source, key, subkey }]) => {
              const value = TRACE_MAPPINGS[
                source as keyof typeof TRACE_MAPPINGS
              ]?.mapping(trace, key!, subkey!);
              return [
                column,
                typeof value !== "string" && typeof value !== "number"
                  ? JSON.stringify(value)
                  : value,
              ];
            })
          ),
        };
      })
    );
  }, [mapping, now, setDatasetEntries, traces]);

  return (
    <VStack align="start" width="full" spacing={2}>
      {Object.entries(mapping).map(
        ([column, { source, key, subkey }], index) => {
          const mapping = source
            ? TRACE_MAPPINGS[source as keyof typeof TRACE_MAPPINGS]
            : undefined;

          return (
            <HStack key={index}>
              <VStack align="start" spacing={2}>
                <Select
                  width="200px"
                  flexShrink={0}
                  onChange={(e) => {
                    setMapping((prev) => ({
                      ...prev,
                      [column]: {
                        source: e.target.value as
                          | keyof typeof TRACE_MAPPINGS
                          | "",
                        key: undefined,
                        subkey: undefined,
                      },
                    }));
                  }}
                  value={source}
                >
                  <option value=""></option>
                  {Object.keys(TRACE_MAPPINGS).map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </Select>
                {mapping && "keys" in mapping && (
                  <HStack width="200px" flexShrink={0} align="start">
                    <Box
                      width="16px"
                      minWidth="16px"
                      height="24px"
                      border="2px solid"
                      borderRadius="0 0 0 6px"
                      borderColor="gray.300"
                      borderTop={0}
                      borderRight={0}
                      marginLeft="12px"
                    />
                    <Select
                      width="full"
                      onChange={(e) => {
                        setMapping((prev) => ({
                          ...prev,
                          [column]: {
                            ...(prev[column] as any),
                            key: e.target.value,
                          },
                        }));
                      }}
                      value={key}
                    >
                      <option value=""></option>
                      {mapping.keys(traces).map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </HStack>
                )}
                {mapping && "subkeys" in mapping && (
                  <HStack width="200px" flexShrink={0} align="start">
                    <Box
                      width="16px"
                      minWidth="16px"
                      height="24px"
                      border="2px solid"
                      borderRadius="0 0 0 6px"
                      borderColor="gray.300"
                      borderTop={0}
                      borderRight={0}
                      marginLeft="12px"
                    />
                    <Select
                      width="full"
                      onChange={(e) => {
                        setMapping((prev) => ({
                          ...prev,
                          [column]: {
                            ...(prev[column] as any),
                            subkey: e.target.value,
                          },
                        }));
                      }}
                      value={subkey}
                    >
                      <option value=""></option>
                      {mapping.subkeys(traces, key!).map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </HStack>
                )}
              </VStack>

              <ArrowRight style={{ flexShrink: 0 }} />
              <Spacer />
              <Text flexShrink={0} whiteSpace="nowrap">
                {column}
              </Text>
            </HStack>
          );
        }
      )}
    </VStack>
  );
};

const esSpansToDatasetSpans = (spans: Span[]): DatasetSpan[] => {
  try {
    return z.array(datasetSpanSchema).parse(spans);
  } catch (e) {
    return spans as any;
  }
};
