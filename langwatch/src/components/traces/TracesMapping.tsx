import {
  Box,
  Field,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";

import { useCallback, useEffect, useMemo, useState } from "react";
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

export const TracesMapping = ({
  titles,
  traces,
  traceMapping,
  datasetFields,
  datasetMapping,
  targetFields,
  setDatasetEntries,
  setTraceMapping,
  setDatasetMapping,
  disableExpansions,
}: {
  titles?: string[];
  traceMapping?: MappingState;
  datasetFields?: string[];
  datasetMapping?: Record<string, string>;
  traces: TraceWithSpans[];
  targetFields: string[];
  setDatasetEntries?: (entries: DatasetRecordEntry[]) => void;
  setTraceMapping?: (mapping: MappingState) => void;
  setDatasetMapping?: (mapping: Record<string, string>) => void;
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

  useEffect(() => {
    // TODO: also have this default for the dataset mapping
    const mappingState = {
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

    setTraceMappingState_(mappingState);
    setTraceMapping?.({
      ...mappingState,
      expansions: Array.from(mappingState.expansions),
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFields]);

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
    <VStack align="start" width="full" gap={2}>
      {titles && (
        <HStack width="full" gap="44px" paddingBottom={2} fontWeight="semibold">
          {titles.map((title) => (
            <Text width="50%" key={title}>
              {title}
            </Text>
          ))}
        </HStack>
      )}
      {Object.entries(mapping).map(
        ([column, { source, key, subkey }], index) => {
          const traceMapping = source ? TRACE_MAPPINGS[source] : undefined;
          const datasetMappingKey = datasetFields?.[index] ?? "";

          const subkeys =
            traceMapping && "subkeys" in traceMapping
              ? traceMapping.subkeys(traces_, key!, {
                  annotationScoreOptions: getAnnotationScoreOptions.data,
                })
              : undefined;

          return (
            <HStack key={index}>
              {datasetFields && (
                <>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={datasetMappingKey}
                      onChange={(e) => {
                        setDatasetMapping?.({
                          ...datasetMapping,
                          [datasetMappingKey]: e.target.value,
                        });
                      }}
                    >
                      <option value=""></option>
                      {datasetFields.map((field) => (
                        <option key={field} value={field}>
                          {field}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                  <ArrowRight style={{ flexShrink: 0 }} />
                </>
              )}
              {traceMapping && (
                <>
                  <VStack align="start" gap={2}>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        onChange={(e) => {
                          setTraceMappingState((prev) => {
                            const targetMapping = e.target.value
                              ? TRACE_MAPPINGS[
                                  e.target.value as keyof typeof TRACE_MAPPINGS
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
                                [column]: {
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
                    {traceMapping && "keys" in traceMapping && (
                      <HStack align="start">
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
                                  [column]: {
                                    ...(prev.mapping[column] as any),
                                    key: e.target.value,
                                  },
                                },
                              }));
                            }}
                            value={key}
                          >
                            <option value=""></option>
                            {traceMapping
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
                      <HStack align="start">
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
                                  [column]: {
                                    ...(prev.mapping[column] as any),
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

                  <ArrowRight style={{ flexShrink: 0 }} />
                </>
              )}
              <Text flexShrink={0} whiteSpace="nowrap">
                {column}
              </Text>
            </HStack>
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
    </VStack>
  );
};
