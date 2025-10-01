import {
  Box,
  Grid,
  GridItem,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
import { Select as MultiSelect } from "chakra-react-select";
import type { DatasetRecordEntry } from "../../server/datasets/types";
import type { Trace } from "~/server/tracer/types";
import {
  type MappingState,
  TRACE_EXPANSIONS,
  TRACE_MAPPINGS,
  mapTraceToDatasetEntry,
} from "../../server/tracer/tracesMapping";

import type { Workflow } from "../../optimization_studio/types/dsl";

/**
 * Thread mappings - simplified set of options for thread-based data
 * Single Responsibility: Define available mapping options for thread data structure
 */
export const THREAD_MAPPINGS = {
  thread_id: {
    mapping: (thread: ThreadData) => thread.thread_id,
  },
  traces: {
    mapping: (thread: ThreadData) => thread.traces,
  },
} as const;

/**
 * Thread mapping type definition
 * Single Responsibility: Type definition for thread mapping configuration
 */
export type ThreadMapping = Record<
  string,
  {
    source: keyof typeof THREAD_MAPPINGS | "";
    selectedFields?: string[]; // Fields to include when source is 'traces'
  }
>;

export type ThreadMappingState = {
  mapping: ThreadMapping;
};

/**
 * Thread data structure - grouped traces by thread_id
 * Single Responsibility: Define the structure for thread data containing grouped traces
 */
type ThreadData = {
  thread_id: string;
  traces: Trace[];
};

/**
 * Utility function to group traces by thread_id
 * Single Responsibility: Group traces by their thread_id metadata
 */
const groupTracesByThreadId = (traces: Trace[]): ThreadData[] => {
  const groupedTraces = traces.reduce(
    (acc, trace) => {
      const threadId = trace.metadata?.thread_id ?? "no_thread";
      if (!acc[threadId]) {
        acc[threadId] = [];
      }
      acc[threadId].push(trace);
      return acc;
    },
    {} as Record<string, Trace[]>
  );

  return Object.entries(groupedTraces).map(([thread_id, traces]) => ({
    thread_id,
    traces,
  }));
};

/**
 * Function to map thread data to dataset entries
 * Single Responsibility: Transform thread data into dataset entries based on mapping configuration
 */
const mapThreadToDatasetEntry = (
  thread: ThreadData,
  mapping: ThreadMapping
): Record<string, string | number> => {
  return Object.fromEntries(
    Object.entries(mapping).map(([column, { source, selectedFields }]) => {
      const source_ = source ? THREAD_MAPPINGS[source] : undefined;
      let value = source_?.mapping(thread);

      // If source is traces and selectedFields are specified, filter the trace objects
      if (source === "traces" && selectedFields && selectedFields.length > 0) {
        const filteredTraces = (thread.traces ?? []).map((trace) => {
          const filteredTrace: Record<string, any> = {};
          for (const field of selectedFields) {
            const traceMapping =
              TRACE_MAPPINGS[field as keyof typeof TRACE_MAPPINGS];
            if (traceMapping) {
              filteredTrace[field] = traceMapping.mapping(
                trace as any,
                "",
                "",
                {}
              );
            }
          }
          return filteredTrace;
        });
        value = filteredTraces as any;
      }

      return [
        column,
        typeof value !== "string" && typeof value !== "number"
          ? JSON.stringify(value)
          : value,
      ];
    })
  );
};

/**
 * ThreadMapping component for mapping thread data to dataset columns
 * Single Responsibility: Provide UI for configuring thread-based data mapping to dataset columns
 */
export const ThreadMapping = ({
  titles,
  traces,
  threadMapping,
  targetFields,
  setDatasetEntries,
  setThreadMapping,
  dsl,
  task: _task,
  skipSettingDefaultEdges,
}: {
  titles?: string[];
  traces: Trace[];
  threadMapping?: ThreadMappingState;
  dsl?: {
    sourceOptions: Record<string, { label: string; fields: string[] }>;
    targetId: string;
    targetEdges: Workflow["edges"];
    setTargetEdges?: (edges: Workflow["edges"]) => void;
  };
  targetFields: string[];
  setDatasetEntries?: (entries: DatasetRecordEntry[]) => void;
  setThreadMapping?: (mapping: ThreadMappingState) => void;
  task?: "real_time" | "batch";
  skipSettingDefaultEdges?: boolean;
}) => {
  const currentMapping = threadMapping ?? { mapping: {} };

  const [threadMappingState, setThreadMappingState_] =
    useState<ThreadMappingState>({
      mapping: {},
    });

  const setThreadMappingState = useCallback(
    (callback: (mappingState: ThreadMappingState) => ThreadMappingState) => {
      setThreadMappingState_((prev) => {
        const newMappingState = callback(prev);
        setThreadMapping?.(newMappingState);
        return newMappingState;
      });
    },
    [setThreadMapping]
  );

  const mapping = threadMappingState.mapping;
  const now = useMemo(() => new Date().getTime(), []);
  const isInitializedRef = React.useRef(false);

  // Initialize mapping with defaults
  useEffect(() => {
    // Build the default mapping state with targetFields
    const threadMappingStateWithDefaults = {
      mapping: Object.fromEntries(
        targetFields.map((name) => {
          // Prefer existing mapping from threadMappingState, then currentMapping, then default
          const existingMapping =
            threadMappingState.mapping[name] ?? currentMapping.mapping[name];
          const defaultMapping = {
            source: (name === "thread_id" ? "thread_id" : "") as
              | keyof typeof THREAD_MAPPINGS
              | "",
            selectedFields: ["input", "output"],
          };
          return [name, existingMapping ?? defaultMapping];
        }) ?? []
      ),
    };

    // Check if we need to update (new columns added, columns removed, or initial setup)
    const currentFieldsSet = new Set(Object.keys(threadMappingState.mapping));
    const targetFieldsSet = new Set(targetFields);
    const fieldsChanged =
      currentFieldsSet.size !== targetFieldsSet.size ||
      !Array.from(targetFieldsSet).every((f) => currentFieldsSet.has(f));

    if (
      !isInitializedRef.current ||
      fieldsChanged ||
      JSON.stringify(threadMappingState) !==
        JSON.stringify(threadMappingStateWithDefaults)
    ) {
      setThreadMappingState_(threadMappingStateWithDefaults);
      setThreadMapping?.(threadMappingStateWithDefaults);

      isInitializedRef.current = true;
    }

    // Initialize DSL edges with defaults
    // if (!dsl) {
    //   return;
    // }

    // const currentTargetEdges = Object.fromEntries(
    //   dsl.targetEdges.map((edge) => [
    //     edge.targetHandle?.split(".")[1] ?? "",
    //     edge,
    //   ])
    // );

    // const targetEdgesWithDefaults = [
    //   ...dsl.targetEdges.filter(
    //     (edge) =>
    //       dsl.sourceOptions[edge.source]?.fields.includes(
    //         edge.sourceHandle?.split(".")[1] ?? ""
    //       )
    //   ),
    //   ...(targetFields
    //     .map((targetField) => {
    //       if (currentTargetEdges[targetField]) {
    //         return;
    //       }

    //       const mappingOptions = [
    //         DATASET_INFERRED_MAPPINGS_BY_NAME[targetField]!,
    //         ...(DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED[targetField] ??
    //           []),
    //       ].filter((x) => x);

    //       let inferredSource:
    //         | { source: string; sourceHandle: string }
    //         | undefined;
    //       for (const [source, { fields }] of Object.entries(
    //         dsl.sourceOptions
    //       )) {
    //         for (const option of mappingOptions) {
    //           if (option && fields.includes(option)) {
    //             inferredSource = { source, sourceHandle: `outputs.${option}` };
    //             break;
    //           }
    //         }
    //       }

    //       if (!inferredSource) {
    //         return;
    //       }

    //       const edge: Workflow["edges"][number] = {
    //         id: `${Date.now()}-${targetField}`,
    //         source: inferredSource.source,
    //         sourceHandle: inferredSource.sourceHandle,
    //         target: dsl.targetId,
    //         targetHandle: `inputs.${targetField}`,
    //         type: "default",
    //       };

    //       return edge;
    //     })
    //     .filter((x) => x) as Workflow["edges"]),
    // ];

    // if (!skipSettingDefaultEdges) {
    //   dsl.setTargetEdges?.(targetEdgesWithDefaults);
    // }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(targetFields),
    dsl?.sourceOptions,
    JSON.stringify(currentMapping),
  ]);

  // Generate dataset entries from grouped traces
  useEffect(() => {
    let index = 0;
    const entries: DatasetRecordEntry[] = [];
    const threadData = groupTracesByThreadId(traces);

    for (const thread of threadData) {
      const mappedEntry = mapThreadToDatasetEntry(thread, mapping);
      entries.push({
        id: `${now}-${index}`,
        selected: true,
        ...mappedEntry,
      });
      index++;
    }

    setDatasetEntries?.(entries);
  }, [mapping, setDatasetEntries, traces, now]);

  const isThreeColumns = !!dsl;

  return (
    <VStack align="start" width="full" gap={3}>
      <Grid
        width="full"
        templateColumns={
          isThreeColumns ? "1fr auto 1fr auto 1fr" : "1fr auto 1fr"
        }
        alignItems="center"
        gap={2}
      >
        {titles?.map((title, idx) => (
          <GridItem
            key={title}
            colSpan={idx === titles.length - 1 ? 1 : 2}
            paddingBottom={2}
          >
            <Text fontWeight="semibold">{title}</Text>
          </GridItem>
        ))}
        {Object.entries(mapping).map(
          ([targetField, { source, selectedFields }], index) => {
            const targetHandle = `inputs.${targetField}`;
            const currentSourceMapping = dsl?.targetEdges
              ?.filter((edge) => edge.targetHandle === `inputs.${targetField}`)
              .map((edge) => `${edge.source}.${edge.sourceHandle}`)[0];

            return (
              <React.Fragment key={index}>
                {isThreeColumns && (
                  <>
                    <GridItem>
                      <NativeSelect.Root width="full">
                        <NativeSelect.Field
                          value={currentSourceMapping ?? ""}
                          onChange={(e) => {
                            const [source, sourceGroup, sourceField] =
                              e.target.value.split(".");

                            dsl.setTargetEdges?.([
                              ...(dsl.targetEdges?.filter(
                                (edge) => edge.targetHandle !== targetHandle
                              ) ?? []),
                              {
                                id: `${Date.now()}-${index}`,
                                source: source ?? "",
                                target: dsl.targetId,
                                sourceHandle: `${sourceGroup}.${sourceField}`,
                                targetHandle: `inputs.${targetField}`,
                                type: "default",
                              },
                            ]);
                          }}
                        >
                          <option value=""></option>
                          {Object.entries(dsl.sourceOptions).map(
                            ([key, { label, fields }]) => {
                              const options = fields.map((field) => (
                                <option
                                  key={field}
                                  value={`${key}.outputs.${field}`}
                                >
                                  {field}
                                </option>
                              ));

                              if (options.length === 0) {
                                return null;
                              }

                              if (Object.keys(dsl.sourceOptions).length === 1) {
                                return options;
                              }

                              return (
                                <optgroup key={key} label={label}>
                                  {options}
                                </optgroup>
                              );
                            }
                          )}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </GridItem>
                    <GridItem>
                      <ArrowRight style={{ flexShrink: 0 }} />
                    </GridItem>
                  </>
                )}
                <GridItem>
                  <VStack align="start" width="full" gap={2}>
                    <NativeSelect.Root width="full">
                      <NativeSelect.Field
                        onChange={(e) => {
                          setThreadMappingState((prev) => ({
                            ...prev,
                            mapping: {
                              ...prev.mapping,
                              [targetField]: {
                                source: e.target.value as
                                  | keyof typeof THREAD_MAPPINGS
                                  | "",
                                selectedFields:
                                  prev.mapping[targetField]?.selectedFields ??
                                  [],
                              },
                            },
                          }));
                        }}
                        value={source}
                      >
                        <option value=""></option>
                        {Object.keys(THREAD_MAPPINGS).map((key) => (
                          <option key={key} value={key}>
                            {key}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                    {source === "traces" && (
                      <HStack align="start" width="full">
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
                        <MultiSelect
                          isMulti
                          options={Object.keys(TRACE_MAPPINGS).map((key) => ({
                            label: key,
                            value: key,
                          }))}
                          value={(selectedFields ?? []).map((field) => ({
                            label: field,
                            value: field,
                          }))}
                          onChange={(newValue) => {
                            setThreadMappingState((prev) => ({
                              ...prev,
                              mapping: {
                                ...prev.mapping,
                                [targetField]: {
                                  source:
                                    prev.mapping[targetField]?.source ?? "",
                                  selectedFields: newValue.map((v) => v.value),
                                },
                              },
                            }));
                          }}
                          placeholder="Select trace fields..."
                          closeMenuOnSelect={false}
                          hideSelectedOptions={false}
                          chakraStyles={{
                            container: (base) => ({
                              ...base,
                              width: "100%",
                              minWidth: "150px",
                            }),
                          }}
                        />
                      </HStack>
                    )}
                  </VStack>
                </GridItem>
                <GridItem>
                  <ArrowRight style={{ flexShrink: 0 }} />
                </GridItem>
                <GridItem>
                  <Text flexShrink={0} whiteSpace="nowrap">
                    {targetField}
                  </Text>
                </GridItem>
              </React.Fragment>
            );
          }
        )}
      </Grid>
    </VStack>
  );
};
