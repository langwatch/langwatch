import { Field, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import type { Entry } from "../../../../../optimization_studio/types/dsl";
import { EvaluatorTracesMapping } from "../../../EvaluatorTracesMapping";
import { StepAccordion } from "../../components/StepAccordion";

export const EvaluatorMappingAccordion = () => {
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
  } = useEvaluationWizardStore(
    useShallow(
      ({
        wizardState,
        getFirstEvaluatorNode,
        setWizardState,
        getFirstEvaluatorEdges,
        setFirstEvaluatorEdges,
        getDSL,
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
      })
    )
  );

  const evaluator = getFirstEvaluatorNode();
  const evaluatorEdges = getFirstEvaluatorEdges();
  const evaluatorType = evaluator?.data.evaluator;
  const evaluatorDefinition = useMemo(() => {
    return evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? AVAILABLE_EVALUATORS[evaluatorType]
      : undefined;
  }, [evaluatorType]);

  const traceMappings = realTimeTraceMappings ?? {
    mapping: {},
    expansions: [],
  };

  const targetFields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
  }, [evaluatorDefinition]);

  const sourceOptions = useMemo(() => {
    return {
      entry: {
        label: "Dataset",
        fields: datasetFields,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(datasetFields)]);

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
                <EvaluatorTracesMapping
                  skipSettingDefaultEdges={true}
                  titles={
                    task == "real_time" && dataSource !== "from_production"
                      ? ["Dataset", "Trace", "Evaluator"]
                      : task == "real_time"
                      ? ["Trace", "Evaluator"]
                      : ["Dataset", "Evaluator"]
                  }
                  targetFields={targetFields}
                  traceMapping={task == "real_time" ? traceMappings : undefined}
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
              </VStack>
            </Field.Root>
          </>
        ) : null}
      </VStack>
    </StepAccordion>
  );
};
