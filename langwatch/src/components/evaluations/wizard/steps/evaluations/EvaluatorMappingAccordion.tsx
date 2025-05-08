import { Field, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import type { Entry } from "../../../../../optimization_studio/types/dsl";
import { EvaluatorTracesMapping } from "../../../EvaluatorTracesMapping";
import { StepAccordion } from "../../components/StepAccordion";
import { useAvailableEvaluators } from "../../../../../hooks/useAvailableEvaluators";

export const EvaluatorMappingAccordion = ({
  selected,
}: {
  selected: boolean;
}) => {
  const {
    realTimeTraceMappings,
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
    return evaluatorType && availableEvaluators && evaluatorType in availableEvaluators
      ? availableEvaluators[evaluatorType]
      : undefined;
  }, [availableEvaluators, evaluatorType]);

  const traceMappings = realTimeTraceMappings ?? {
    mapping: {},
    expansions: [],
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

  return (
    <StepAccordion
      value="mappings"
      width="full"
      borderColor="green.400"
      title="Data Mapping"
      showTrigger={!!evaluatorCategory}
    >
      <VStack align="start" padding={2} paddingBottom={5} width="full" gap={8}>
        {evaluatorDefinition ? (
          <>
            <Text>
              {task == "real_time" && dataSource !== "from_production"
                ? "From the dataset you chose, what columns are equivalent to the real time trace data which will be used for evaluation during monitoring?"
                : task == "real_time"
                ? "What data from the real time traces will be used for evaluation?"
                : "What data from the dataset will be used for evaluation?"}
            </Text>
            <Field.Root>
              <VStack align="start" gap={4} width="full">
                {selected && (
                  <EvaluatorTracesMapping
                    skipSettingDefaultEdges={true}
                    titles={
                      task == "real_time" && dataSource !== "from_production"
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
                      evaluator?.id
                        ? {
                            sourceOptions,
                            targetId: evaluator?.id ?? "",
                            targetEdges: evaluatorEdges ?? [],
                            /**
                             * This was confusing for me when I first saw it,
                             * but basically it's just setting a callback to update the evaluator edges
                             * whenever the dsl edges change.
                             *
                             * However, if there are no edges, it will use defaults hidden in the logic:
                             * The defaults will come from the dataset inferred mappings,
                             * which is what we want for realtime evals, but not for offline evals
                             */
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
              </VStack>
            </Field.Root>
          </>
        ) : null}
      </VStack>
    </StepAccordion>
  );
};
