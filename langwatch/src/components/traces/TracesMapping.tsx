import {
  Box,
  Field,
  Grid,
  GridItem,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { DatasetRecordEntry } from "../../server/datasets/types";
import {
  type MappingState,
  TRACE_EXPANSIONS,
  TRACE_MAPPINGS,
  mapTraceToDatasetEntry,
} from "../../server/tracer/tracesMapping";
import type { TraceWithSpans } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { Switch } from "../ui/switch";
import type { Workflow } from "../../optimization_studio/types/dsl";

export const DATASET_INFERRED_MAPPINGS_BY_NAME: Record<
  string,
  keyof typeof TRACE_MAPPINGS
> = {
  trace_id: "trace_id",
  timestamp: "timestamp",
  input: "input",
  question: "input",
  user_input: "input",
  output: "output",
  answer: "output",
  response: "output",
  result: "output",
  expected_output: "output",
  total_cost: "metrics.total_cost",
  contexts: "contexts.string_list",
  spans: "spans",
};
const DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED = Object.entries(
  DATASET_INFERRED_MAPPINGS_BY_NAME
).reduce(
  (acc, [key, value]) => {
    if (acc[value]) {
      acc[value]!.push(key);
    } else {
      acc[value] = [key];
    }
    return acc;
  },
  {} as Record<string, string[]>
);

export const TracesMapping = ({
  titles,
  traces,
  traceMapping,
  dsl,
  targetFields,
  setDatasetEntries,
  setTraceMapping,
  disableExpansions,
}: {
  titles?: string[];
  traces: TraceWithSpans[];
  traceMapping?: MappingState;
  dsl?: {
    sourceOptions: Record<string, { label: string; fields: string[] }>;
    targetId: string;
    targetEdges: Workflow["edges"];
    setTargetEdges?: (edges: Workflow["edges"]) => void;
  };
  targetFields: string[];
  setDatasetEntries?: (entries: DatasetRecordEntry[]) => void;
  setTraceMapping?: (mapping: MappingState) => void;
  disableExpansions?: boolean;
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

  const currentMapping = traceMapping ?? { mapping: {}, expansions: [] };

  type LocalTraceMappingState = Omit<MappingState, "expansions"> & {
    expansions: Set<keyof typeof TRACE_EXPANSIONS>;
  };

  const [traceMappingState, setTraceMappingState_] =
    useState<LocalTraceMappingState>({
      mapping: {},
      expansions: new Set(),
    });
  const setTraceMappingState = useCallback(
    (
      callback: (mappingState: LocalTraceMappingState) => LocalTraceMappingState
    ) => {
      const newMappingState = callback(traceMappingState);
      setTraceMappingState_(newMappingState);
      setTraceMapping?.({
        ...newMappingState,
        expansions: Array.from(newMappingState.expansions),
      });
    },
    [traceMappingState, setTraceMapping]
  );
  const mapping = traceMappingState.mapping;

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
        Array.from(traceMappingState.expansions).filter((x) =>
          availableExpansions.has(x)
        )
      ),
    [traceMappingState.expansions, availableExpansions]
  );

  const now = useMemo(() => new Date().getTime(), []);
  const isInitializedRef = React.useRef(false);

  useEffect(() => {
    if (
      isInitializedRef.current &&
      Object.keys(traceMappingState.mapping).length > 0
    ) {
      return;
    }

    const traceMappingStateWithDefaults = {
      mapping: Object.fromEntries(
        targetFields.map((name) => [
          name,
          currentMapping.mapping[name] ?? {
            source: (DATASET_INFERRED_MAPPINGS_BY_NAME[name] ??
              "") as keyof typeof TRACE_MAPPINGS,
          },
        ]) ?? []
      ),
      expansions: new Set(currentMapping.expansions),
    };

    if (
      JSON.stringify(traceMappingState) !==
      JSON.stringify(traceMappingStateWithDefaults)
    ) {
      setTraceMappingState_(traceMappingStateWithDefaults);
      setTraceMapping?.({
        ...traceMappingStateWithDefaults,
        expansions: Array.from(traceMappingStateWithDefaults.expansions),
      });

      isInitializedRef.current = true;
    }

    if (!dsl) return;

    const currentTargetEdges = Object.fromEntries(
      dsl.targetEdges.map((edge) => [
        edge.targetHandle?.split(".")[1] ?? "",
        edge,
      ])
    );
    const targetEdgesWithDefaults = [
      ...dsl.targetEdges.filter(
        (edge) =>
          dsl.sourceOptions[edge.source]?.fields.includes(
            edge.sourceHandle?.split(".")[1] ?? ""
          )
      ),
      ...(targetFields
        .map((targetField) => {
          if (currentTargetEdges[targetField]) {
            return;
          }

          const mappingOptions = [
            DATASET_INFERRED_MAPPINGS_BY_NAME[targetField]!,
            ...(DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED[targetField] ??
              []),
          ].filter((x) => x);

          let inferredSource:
            | { source: string; sourceHandle: string }
            | undefined;
          for (const [source, { fields }] of Object.entries(
            dsl.sourceOptions
          )) {
            for (const option of mappingOptions) {
              if (option && fields.includes(option)) {
                inferredSource = { source, sourceHandle: `outputs.${option}` };
                break;
              }
            }
          }

          if (!inferredSource) {
            return;
          }

          const edge: Workflow["edges"][number] = {
            id: `${Date.now()}-${targetField}`,
            source: inferredSource.source,
            sourceHandle: inferredSource.sourceHandle,
            target: dsl.targetId,
            targetHandle: `inputs.${targetField}`,
            type: "default",
          };

          return edge;
        })
        .filter((x) => x) as Workflow["edges"]),
    ];
    dsl.setTargetEdges?.(targetEdgesWithDefaults);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFields, dsl?.sourceOptions]);

  useEffect(() => {
    let index = 0;
    const entries: DatasetRecordEntry[] = [];

    for (const trace of traces_) {
      const mappedEntries = mapTraceToDatasetEntry(
        trace,
        mapping,
        expansions,
        getAnnotationScoreOptions.data
      );

      // Add each expanded entry to the final results
      for (const entry of mappedEntries) {
        entries.push({
          id: `${now}-${index}`,
          selected: true,
          ...entry,
        });
        index++;
      }
    }

    setDatasetEntries?.(entries);
  }, [
    expansions,
    getAnnotationScoreOptions.data,
    mapping,
    setDatasetEntries,
    traces_,
    project?.id,
    now,
  ]);

  return (
    <Grid
      width="full"
      templateColumns={"1fr auto 1fr"}
      alignItems="center"
      gap={2}
    >
      {titles?.map((title, idx) => (
        <GridItem
          key={title}
          colSpan={idx == titles.length - 1 ? 1 : 2}
          paddingBottom={2}
        >
          <Text fontWeight="semibold">{title}</Text>
        </GridItem>
      ))}
      {Object.entries(mapping).map(
        ([targetField, { source, key, subkey }], index) => {
          const traceMappingDefinition = source
            ? TRACE_MAPPINGS[source]
            : undefined;

          const subkeys =
            traceMappingDefinition && "subkeys" in traceMappingDefinition
              ? traceMappingDefinition.subkeys(traces_, key!, {
                  annotationScoreOptions: getAnnotationScoreOptions.data,
                })
              : undefined;

          const targetHandle = `inputs.${targetField}`;
          const currentSourceMapping = dsl?.targetEdges
            ?.filter((edge) => edge.targetHandle === `inputs.${targetField}`)
            .map((edge) => `${edge.source}.${edge.sourceHandle}`)[0];

          return (
            <React.Fragment key={index}>
              {dsl && (
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
              {traceMapping && (
                <>
                  <GridItem>
                    <VStack align="start" width="full" gap={2}>
                      <NativeSelect.Root width="full">
                        <NativeSelect.Field
                          onChange={(e) => {
                            setTraceMappingState((prev) => {
                              const targetMapping = e.target.value
                                ? TRACE_MAPPINGS[
                                    e.target
                                      .value as keyof typeof TRACE_MAPPINGS
                                  ]
                                : undefined;

                              let newExpansions = expansions;
                              if (
                                targetMapping &&
                                "expandable_by" in targetMapping &&
                                targetMapping.expandable_by &&
                                !availableExpansions.has(
                                  targetMapping.expandable_by
                                )
                              ) {
                                newExpansions = new Set([
                                  ...new Set(Array.from(newExpansions)),
                                  targetMapping.expandable_by,
                                ]);
                              }

                              return {
                                ...prev,
                                mapping: {
                                  ...prev.mapping,
                                  [targetField]: {
                                    source: e.target.value as
                                      | keyof typeof TRACE_MAPPINGS
                                      | "",
                                    key: undefined,
                                    subkey: undefined,
                                  },
                                },
                                expansions: newExpansions,
                              };
                            });
                          }}
                          value={source}
                        >
                          <option value=""></option>
                          {Object.keys(TRACE_MAPPINGS).map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      {traceMappingDefinition &&
                        "keys" in traceMappingDefinition && (
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
                            <NativeSelect.Root width="full">
                              <NativeSelect.Field
                                onChange={(e) => {
                                  setTraceMappingState((prev) => ({
                                    ...prev,
                                    mapping: {
                                      ...prev.mapping,
                                      [targetField]: {
                                        ...(prev.mapping[targetField] as any),
                                        key: e.target.value,
                                      },
                                    },
                                  }));
                                }}
                                value={key}
                              >
                                <option value=""></option>
                                {traceMappingDefinition
                                  .keys(traces_)
                                  .map(({ key, label }) => (
                                    <option key={key} value={key}>
                                      {label}
                                    </option>
                                  ))}
                              </NativeSelect.Field>
                              <NativeSelect.Indicator />
                            </NativeSelect.Root>
                          </HStack>
                        )}
                      {subkeys && subkeys.length > 0 && (
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
                          <NativeSelect.Root width="full">
                            <NativeSelect.Field
                              onChange={(e) => {
                                setTraceMappingState((prev) => ({
                                  ...prev,
                                  mapping: {
                                    ...prev.mapping,
                                    [targetField]: {
                                      ...(prev.mapping[targetField] as any),
                                      subkey: e.target.value,
                                    },
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
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                        </HStack>
                      )}
                    </VStack>
                  </GridItem>
                  <GridItem>
                    <ArrowRight style={{ flexShrink: 0 }} />
                  </GridItem>
                </>
              )}
              <GridItem>
                <Text flexShrink={0} whiteSpace="nowrap">
                  {targetField}
                </Text>
              </GridItem>
            </React.Fragment>
          );
        }
      )}

      {!disableExpansions && availableExpansions.size > 0 && (
        <Field.Root width="full" paddingY={4} marginTop={2}>
          <VStack align="start">
            <Field.Label margin={0}>Expansions</Field.Label>
            <Field.HelperText
              margin={0}
              fontSize="13px"
              marginBottom={2}
              maxWidth="600px"
            >
              Normalize the dataset to duplicate the rows and have one entry per
              line instead of an array for the following mappings:
            </Field.HelperText>
          </VStack>
          <VStack align="start" paddingTop={2} gap={2}>
            {Array.from(availableExpansions).map((expansion) => (
              <HStack key={expansion}>
                <Switch
                  checked={expansions.has(expansion)}
                  onCheckedChange={(event) => {
                    const isChecked = event.checked;

                    setTraceMappingState((prev) => {
                      const newExpansions = isChecked
                        ? new Set([...prev.expansions, expansion])
                        : new Set(
                            Array.from(prev.expansions).filter(
                              (x) => x !== expansion
                            )
                          );

                      return {
                        ...prev,
                        expansions: newExpansions,
                      };
                    });
                  }}
                />
                <Text>One row per {TRACE_EXPANSIONS[expansion].label}</Text>
              </HStack>
            ))}
          </VStack>
        </Field.Root>
      )}
    </Grid>
  );
};
