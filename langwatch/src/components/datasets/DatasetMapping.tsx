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

const TRACE_MAPPINGS = {
  trace_id: {
    mapping: (trace: TraceWithSpans) => trace.trace_id,
  },
  timestamp: {
    mapping: (trace: TraceWithSpans) =>
      new Date(trace.timestamps.started_at).toISOString(),
  },
  input: {
    mapping: (trace: TraceWithSpans) => trace.input?.value ?? "",
  },
  output: {
    mapping: (trace: TraceWithSpans) => trace.output?.value ?? "",
  },
  contexts: {
    mapping: (trace: TraceWithSpans) =>
      JSON.stringify(getRAGChunks(trace.spans ?? [])),
  },
  "contexts.string_list": {
    mapping: (trace: TraceWithSpans) => {
      try {
        return JSON.stringify(getRAGInfo(trace.spans ?? []).contexts ?? []);
      } catch (e) {
        return JSON.stringify([]);
      }
    },
  },
  "metrics.total_cost": {
    mapping: (trace: TraceWithSpans) => trace.metrics?.total_cost ?? 0,
  },
  "metrics.first_token_ms": {
    mapping: (trace: TraceWithSpans) => trace.metrics?.first_token_ms ?? 0,
  },
  "metrics.total_time_ms": {
    mapping: (trace: TraceWithSpans) => trace.metrics?.total_time_ms ?? 0,
  },
  "metrics.prompt_tokens": {
    mapping: (trace: TraceWithSpans) => trace.metrics?.prompt_tokens ?? 0,
  },
  "metrics.completion_tokens": {
    mapping: (trace: TraceWithSpans) => trace.metrics?.completion_tokens ?? 0,
  },
  "metrics.total_tokens": {
    mapping: (trace: TraceWithSpans) =>
      (trace.metrics?.prompt_tokens ?? 0) +
      (trace.metrics?.completion_tokens ?? 0),
  },
  spans: {
    mapping: (trace: TraceWithSpans) =>
      JSON.stringify(esSpansToDatasetSpans(trace.spans ?? [])),
  },
  "spans.llm.input": {
    mapping: (trace: TraceWithSpans) =>
      JSON.stringify(
        trace.spans
          ?.filter((span) => span.type === "llm")
          ?.map((span) => span.input?.value) ?? []
      ),
    expandable_by: "spans.span_id",
  },
  "spans.llm.output": {
    mapping: (trace: TraceWithSpans) =>
      JSON.stringify(
        trace.spans
          ?.filter((span) => span.type === "llm")
          ?.map((span) => span.output?.value) ?? []
      ),
    expandable_by: "spans.span_id",
  },
  metadata: {
    keys: (traces: TraceWithSpans[]) =>
      Array.from(
        new Set(traces.flatMap((trace) => Object.keys(trace.metadata ?? {})))
      ).map((key) => ({ key, label: key })),
    mapping: (trace: TraceWithSpans, key: string) =>
      key ? (trace.metadata?.[key] as any) : JSON.stringify(trace.metadata),
  },
  evaluations: {
    keys: (traces: TraceWithSpans[]) => {
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
    subkeys: (traces: TraceWithSpans[], key: string) => {
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
    mapping: (trace: TraceWithSpans, key: string, subkey: string) => {
      if (!key) {
        return JSON.stringify(trace.evaluations ?? []);
      }
      const evaluation = trace.evaluations?.find(
        (evaluation) => evaluation.evaluator_id === key
      );
      if (!subkey) {
        return JSON.stringify(evaluation);
      }
      return evaluation?.[subkey as keyof Evaluation] as string | number;
    },
  },
} satisfies Record<
  string,
  {
    keys?: (traces: TraceWithSpans[]) => { key: string; label: string }[];
    subkeys?: (
      traces: TraceWithSpans[],
      key: string
    ) => {
      key: string;
      label: string;
    }[];
    mapping:
      | ((trace: TraceWithSpans) => string | number)
      | ((trace: TraceWithSpans, key: string) => string | number)
      | ((
          trace: TraceWithSpans,
          key: string,
          subkey: string
        ) => string | number);
    expandable_by?: "spans.span_id";
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
      traces.map((trace, index) => ({
        id: `${now}-${index}`,
        selected: true,
        ...Object.fromEntries(
          Object.entries(mapping).map(([column, { source, key, subkey }]) => [
            column,
            TRACE_MAPPINGS[source as keyof typeof TRACE_MAPPINGS]?.mapping(
              trace,
              key!,
              subkey!
            ),
          ])
        ),
      }))
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
