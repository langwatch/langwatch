import {
  Box,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Select,
  Spacer,
  Switch,
  Text,
  VStack,
} from "@chakra-ui/react";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
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
import type { Annotation, AnnotationScore, User } from "@prisma/client";

type TraceWithSpansAndAnnotations = TraceWithSpans & {
  annotations?: (Annotation & {
    user?: User | null;
  })[];
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
      return ["comment", "is_thumbs_up", "author", "score"].map((key) => ({
        key,
        label: key,
      }));
    },
    subkeys: (
      traces: TraceWithSpansAndAnnotations[],
      key: string,
      data: { annotationScoreOptions?: AnnotationScore[] }
    ) => {
      if (key !== "score") {
        return [];
      }

      return Object.entries(
        Object.fromEntries(
          traces.flatMap(
            (trace) =>
              trace.annotations?.flatMap((annotation) =>
                Object.entries(annotation.scoreOptions ?? {})
                  .filter(([_key, score]) => score.value !== null)
                  .map(([key]) => [
                    key,
                    data.annotationScoreOptions?.find(
                      (score) => score.id === key
                    )?.name,
                  ])
                  .filter(([_key, label]) => !!label)
              ) ?? []
          )
        )
      ).map(([key, label]) => ({
        key: key,
        label: (label as string) ?? "",
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
        if (
          key === "score" &&
          subkey &&
          typeof annotation.scoreOptions === "object"
        ) {
          return (annotation.scoreOptions as any)[subkey]?.value;
        }
        const keyMap = {
          comment: () => annotation.comment,
          is_thumbs_up: () => annotation.isThumbsUp,
          author: () => annotation.user?.name ?? annotation.email ?? "",
          score: () =>
            Object.fromEntries(
              Object.entries(annotation.scoreOptions ?? {})
                .map(([key, score]) => [
                  data.annotationScoreOptions?.find((score) => score.id === key)
                    ?.name ?? key,
                  score,
                ])
                .filter(([_key, score]) => score.value !== null)
            ),
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

const TRACE_EXPANSIONS = {
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
} satisfies Record<
  string,
  {
    label: string;
    expansion: (
      trace: TraceWithSpansAndAnnotations
    ) => TraceWithSpansAndAnnotations[];
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
  const traces_ = useMemo(
    () =>
      traces.map((trace) => ({
        ...trace,
        annotations: annotationScores.data?.filter(
          (annotation) => annotation.traceId === trace.trace_id
        ),
      })),
    [traces, annotationScores.data]
  );

  const [mapping, setMapping] = useState<Mapping>({});
  const [localStorageMapping, setLocalStorageMapping] = useLocalStorage<{
    mapping: Mapping;
    expansions: string[];
  }>("datasetMapping", { mapping: {}, expansions: [] });

  const [expansions_, setExpansions] = useState<
    Set<keyof typeof TRACE_EXPANSIONS>
  >(new Set());
  const availableExpansions = useMemo(
    () =>
      new Set(
        Object.values(mapping)
          .map((mapping) => {
            const source = mapping.source && TRACE_MAPPINGS[mapping.source];
            if (source && "expandable_by" in source && source.expandable_by) {
              return source.expandable_by;
            }
            return;
          })
          .filter(Boolean)
          .map((x) => x!)
      ),
    [mapping]
  );
  const expansions = useMemo(
    () =>
      new Set(
        Array.from(expansions_).filter((x) => availableExpansions.has(x))
      ),
    [expansions_, availableExpansions]
  );

  const now = useMemo(() => new Date().getTime(), []);

  useEffect(() => {
    setMapping(
      Object.fromEntries(
        columnTypes?.map(({ name }) => [
          name,
          localStorageMapping.mapping[name] ?? {
            source: DATASET_INFERRED_MAPPINGS_BY_NAME[name] ?? "",
          },
        ]) ?? []
      )
    );
    setExpansions(
      new Set(
        localStorageMapping.expansions as (keyof typeof TRACE_EXPANSIONS)[]
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnTypes]);

  useEffect(() => {
    setLocalStorageMapping({
      mapping: mapping,
      expansions: Array.from(expansions),
    });

    let index = 0;
    const entries: DatasetRecordEntry[] = [];
    let expandedTraces: TraceWithSpansAndAnnotations[] = traces_;
    for (const expansion of expansions) {
      expandedTraces = expandedTraces.flatMap((trace) =>
        TRACE_EXPANSIONS[expansion].expansion(trace)
      );
    }

    for (const trace of expandedTraces) {
      const entry = Object.fromEntries(
        Object.entries(mapping).map(([column, { source, key, subkey }]) => {
          const source_ = source ? TRACE_MAPPINGS[source] : undefined;

          let value = source_?.mapping(trace, key!, subkey!, {
            annotationScoreOptions: getAnnotationScoreOptions.data,
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
      );

      entries.push({
        id: `${now}-${index}`,
        selected: true,
        ...entry,
      });
      index++;
    }
    setDatasetEntries(entries);
  }, [
    expansions,
    getAnnotationScoreOptions.data,
    mapping,
    now,
    setDatasetEntries,
    setLocalStorageMapping,
    traces_,
  ]);

  return (
    <VStack align="start" width="full" spacing={2}>
      {Object.entries(mapping).map(
        ([column, { source, key, subkey }], index) => {
          const mapping = source ? TRACE_MAPPINGS[source] : undefined;

          const subkeys =
            mapping && "subkeys" in mapping
              ? mapping.subkeys(traces_, key!, {
                  annotationScoreOptions: getAnnotationScoreOptions.data,
                })
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
                    const newMapping = e.target.value
                      ? TRACE_MAPPINGS[
                          e.target.value as keyof typeof TRACE_MAPPINGS
                        ]
                      : undefined;
                    if (
                      newMapping &&
                      "expandable_by" in newMapping &&
                      newMapping.expandable_by &&
                      !availableExpansions.has(newMapping.expandable_by)
                    ) {
                      setExpansions(
                        (prev) => new Set([...prev, newMapping.expandable_by])
                      );
                    }
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
                      {mapping.keys(traces_).map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </HStack>
                )}
                {subkeys && subkeys.length > 0 && (
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
                      {subkeys.map(({ key, label }) => (
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

      {availableExpansions.size > 0 && (
        <FormControl width="full" paddingY={4} marginTop={2}>
          <VStack align="start">
            <FormLabel margin={0}>Expansions</FormLabel>
            <FormHelperText
              margin={0}
              fontSize={13}
              marginBottom={2}
              maxWidth="600px"
            >
              Normalize the dataset to duplicate the rows and have one entry per
              line instead of an array for the following columns:
            </FormHelperText>
          </VStack>
          <VStack align="start" paddingTop={2} spacing={2}>
            {Array.from(availableExpansions).map((expansion) => (
              <HStack key={expansion}>
                <Switch
                  isChecked={expansions.has(expansion)}
                  onChange={(e) => {
                    setExpansions((prev) =>
                      e.target.checked
                        ? new Set([...prev, expansion])
                        : new Set(
                            Array.from(prev).filter((x) => x !== expansion)
                          )
                    );
                  }}
                />
                <Text>One row per {TRACE_EXPANSIONS[expansion].label}</Text>
              </HStack>
            ))}
          </VStack>
        </FormControl>
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
