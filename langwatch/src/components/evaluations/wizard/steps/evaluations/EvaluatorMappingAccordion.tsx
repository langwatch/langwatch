import { Field, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import type { Entry } from "../../../../../optimization_studio/types/dsl";
import { EvaluatorTracesMapping } from "../../../EvaluatorTracesMapping";
import { StepAccordion } from "../../components/StepAccordion";
import { useAvailableEvaluators } from "../../../../../hooks/useAvailableEvaluators";
import { Switch } from "../../../../ui/switch";
import { ThreadMapping } from "../../../../traces/ThreadMapping";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../../utils/api";
import { useFilterParams } from "../../../../../hooks/useFilterParams";
import { mergeThreadAndTraceMappings } from "../../../../../server/tracer/tracesMapping";

export const EvaluatorMappingAccordion = ({
  selected,
}: {
  selected: boolean;
}) => {
  const { project } = useOrganizationTeamProject();

  const {
    realTimeTraceMappings,
    realTimeThreadMappings,
    isThreadMapping,
    task,
    dataSource,
    evaluatorCategory,
    getFirstEvaluatorNode,
    setWizardState,
    getFirstEvaluatorEdges,
    setFirstEvaluatorEdges,
    datasetFields,
    executorNode,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        wizardState,
        getFirstEvaluatorNode,
        setWizardState,
        getFirstEvaluatorEdges,
        setFirstEvaluatorEdges,
        getDSL,
        getFirstExecutorNode,
      }) => ({
        realTimeTraceMappings: wizardState.realTimeTraceMappings,
        realTimeThreadMappings: wizardState.realTimeThreadMappings,
        isThreadMapping: wizardState.isThreadMapping ?? false,
        task: wizardState.task,
        dataSource: wizardState.dataSource,
        evaluatorCategory: wizardState.evaluatorCategory,
        getFirstEvaluatorNode,
        setWizardState,
        getFirstEvaluatorEdges,
        setFirstEvaluatorEdges,
        datasetFields:
          (
            getDSL().nodes.find((node) => node.type === "entry")?.data as Entry
          )?.outputs?.map((field) => field.identifier) ?? [],
        executorNode: getFirstExecutorNode(),
      })
    )
  );

  const evaluator = getFirstEvaluatorNode();
  const evaluatorEdges = getFirstEvaluatorEdges();
  const evaluatorType = evaluator?.data.evaluator;
  const availableEvaluators = useAvailableEvaluators();
  const evaluatorDefinition = useMemo(() => {
    return evaluatorType &&
      availableEvaluators &&
      evaluatorType in availableEvaluators
      ? availableEvaluators[evaluatorType]
      : undefined;
  }, [availableEvaluators, evaluatorType]);

  const traceMappings = realTimeTraceMappings ?? {
    mapping: {},
    expansions: [],
  };

  const threadMappings = realTimeThreadMappings ?? {
    mapping: {},
  };

  const targetFields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatorDefinition, evaluatorType]);

  const executorFields = useMemo(() => {
    return executorNode?.data.outputs?.map((field) => field.identifier) ?? [];
  }, [executorNode]);

  const sourceOptions = useMemo(() => {
    return {
      entry: {
        label: "Dataset",
        fields: datasetFields,
      },
      ...(executorNode?.id
        ? {
            [executorNode.id]: {
              label: "Executor",
              fields: executorFields,
            },
          }
        : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(datasetFields),
    evaluatorType,
    executorNode?.id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(executorFields),
  ]);

  // Fetch sample traces
  const { filterParams, queryOpts } = useFilterParams();
  const recentTraces = api.traces.getSampleTracesDataset.useQuery(
    filterParams,
    queryOpts
  );

  // Extract thread_ids from traces
  const threadIds = useMemo(() => {
    const ids = (recentTraces.data ?? [])
      .map((trace) => trace.metadata?.thread_id)
      .filter((id): id is string => !!id);
    return Array.from(new Set(ids));
  }, [recentTraces.data]);

  // Fetch all traces with matching thread_ids when thread mapping is enabled
  const threadTraces = api.traces.getTracesWithSpansByThreadIds.useQuery(
    {
      projectId: project?.id ?? "",
      threadIds: threadIds,
    },
    {
      enabled: !!project && isThreadMapping && threadIds.length > 0,
      refetchOnWindowFocus: false,
    }
  );

  // Use thread traces when thread mapping is enabled, otherwise use provided traces
  const tracesToUse = useMemo(() => {
    if (isThreadMapping && threadTraces.data) {
      return threadTraces.data;
    }
    return recentTraces.data ?? [];
  }, [isThreadMapping, threadTraces.data, recentTraces.data]);

  // Automatically merge thread and trace mappings when they change
  useEffect(() => {
    if (!isThreadMapping) {
      // When thread mapping is disabled, ensure we're using trace mappings
      return;
    }

    // Merge thread mappings into trace mappings
    const merged = mergeThreadAndTraceMappings(
      traceMappings,
      threadMappings,
      isThreadMapping
    );

    // Only update if there's a meaningful change
    if (
      isThreadMapping &&
      threadMappings &&
      Object.keys(threadMappings.mapping).length > 0 &&
      JSON.stringify(merged) !== JSON.stringify(traceMappings)
    ) {
      setWizardState({
        realTimeTraceMappings: merged,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isThreadMapping,
    JSON.stringify(threadMappings),
    JSON.stringify(traceMappings),
  ]);

  return (
    <StepAccordion
      value="mappings"
      width="full"
      borderColor="green.400"
      title="Data Mapping"
      showTrigger={!!evaluatorCategory}
    >
      <VStack
        align="start"
        padding={2}
        paddingBottom={5}
        width="full"
        gap={8}
        overflow="visible"
      >
        {evaluatorDefinition ? (
          <>
            <VStack align="start" width="full" gap={4}>
              <Text>
                {task == "real_time" && dataSource !== "from_production"
                  ? "From the dataset you chose, what columns are equivalent to the real time trace data which will be used for evaluation during monitoring?"
                  : task == "real_time"
                  ? "What data from the real time traces will be used for evaluation?"
                  : "What data from the dataset will be used for evaluation?"}
              </Text>

              {task == "real_time" && (
                <HStack width="full" justify="space-between" paddingY={2}>
                  <Text fontSize="sm" fontWeight="medium">
                    Use thread-based mapping
                  </Text>
                  <Switch
                    checked={isThreadMapping}
                    onCheckedChange={(e) => {
                      setWizardState({
                        isThreadMapping: e.checked,
                      });
                    }}
                  />
                </HStack>
              )}
            </VStack>

            <Field.Root width="full" overflow="visible">
              <VStack align="start" gap={4} width="full" overflow="visible">
                {selected && (
                  <>
                    {isThreadMapping ? (
                      <ThreadMapping
                        titles={
                          dataSource !== "from_production" &&
                          datasetFields.length > 0
                            ? ["Dataset", "Thread", "Evaluator"]
                            : ["Thread", "Evaluator"]
                        }
                        traces={tracesToUse}
                        threadMapping={threadMappings}
                        targetFields={targetFields}
                        dsl={
                          evaluator?.id &&
                          dataSource !== "from_production" &&
                          datasetFields.length > 0
                            ? {
                                sourceOptions,
                                targetId: evaluator?.id ?? "",
                                targetEdges: evaluatorEdges ?? [],
                                setTargetEdges: (mapping) => {
                                  setFirstEvaluatorEdges(mapping);
                                },
                              }
                            : undefined
                        }
                        setThreadMapping={(mapping) => {
                          setWizardState({
                            realTimeThreadMappings: mapping,
                          });
                        }}
                      />
                    ) : (
                      <EvaluatorTracesMapping
                        skipSettingDefaultEdges={true}
                        titles={
                          task == "real_time" &&
                          dataSource !== "from_production" &&
                          datasetFields.length > 0
                            ? ["Dataset", "Trace", "Evaluator"]
                            : task == "real_time"
                            ? ["Trace", "Evaluator"]
                            : ["Data", "Evaluator"]
                        }
                        targetFields={targetFields}
                        traceMapping={
                          task == "real_time" ? traceMappings : undefined
                        }
                        dsl={
                          evaluator?.id &&
                          task == "real_time" &&
                          dataSource !== "from_production" &&
                          datasetFields.length > 0
                            ? {
                                sourceOptions,
                                targetId: evaluator?.id ?? "",
                                targetEdges: evaluatorEdges ?? [],
                                setTargetEdges: (mapping) => {
                                  setFirstEvaluatorEdges(mapping);
                                },
                              }
                            : undefined
                        }
                        setTraceMapping={(mapping) => {
                          setWizardState({
                            realTimeTraceMappings: mapping,
                          });
                        }}
                      />
                    )}
                  </>
                )}
              </VStack>
            </Field.Root>
          </>
        ) : null}
      </VStack>
    </StepAccordion>
  );
};
