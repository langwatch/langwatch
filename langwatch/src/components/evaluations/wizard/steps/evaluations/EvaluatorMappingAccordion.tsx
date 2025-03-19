import { Accordion, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import {
  AVAILABLE_EVALUATORS,
  type Evaluators,
} from "~/server/evaluations/evaluators.generated";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import type { DatasetColumns } from "../../../../../server/datasets/types";
import { api } from "../../../../../utils/api";
import { EvaluatorTracesMapping } from "../../../EvaluatorTracesMapping";

export const EvaluatorMappingAccordion = () => {
  const { project } = useOrganizationTeamProject();
  const {
    wizardState,
    getFirstEvaluatorNode: getFirstEvaluator,
    getDatasetId,
    setWizardState,
    getFirstEvaluatorEdges,
    setFirstEvaluatorEdges,
  } = useEvaluationWizardStore();

  const evaluator = getFirstEvaluator();
  const evaluatorEdges = getFirstEvaluatorEdges();
  const evaluatorType = evaluator?.data.evaluator;
  const evaluatorDefinition = useMemo(() => {
    return evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? AVAILABLE_EVALUATORS[evaluatorType as keyof Evaluators]
      : undefined;
  }, [evaluatorType]);

  const traceMappings = wizardState.realTimeTraceMappings ?? {
    // It's okay to be empty, TracesMapping will fill it up with default mappings on first render
    mapping: {},
    expansions: [],
  };

  const targetFields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
  }, [evaluatorDefinition]);

  const datasetId = getDatasetId();
  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );
  const datasetFields = useMemo(() => {
    return (
      (databaseDataset.data?.columnTypes as DatasetColumns)?.map(
        ({ name }) => name
      ) ?? []
    );
  }, [databaseDataset.data]);

  return (
    <Accordion.Item
      value="mappings"
      width="full"
      hidden={!wizardState.evaluatorCategory}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Data Mapping</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <VStack
          align="start"
          padding={2}
          paddingBottom={5}
          width="full"
          gap={8}
        >
          {evaluatorDefinition ? (
            <>
              <Text>
                {wizardState.task == "real_time" &&
                wizardState.dataSource !== "from_production"
                  ? "From the dataset you chose, what columns are equivalent to the real time trace data which will be used for evaluation during monitoring?"
                  : wizardState.task == "real_time"
                  ? "What data from the real time traces will be used for evaluation?"
                  : "What data from the dataset will be used for evaluation?"}
              </Text>
              <Field.Root>
                <VStack align="start" gap={4} width="full">
                  <EvaluatorTracesMapping
                    titles={
                      wizardState.task == "real_time" &&
                      wizardState.dataSource !== "from_production"
                        ? ["Dataset", "Trace", "Evaluator"]
                        : wizardState.task == "real_time"
                        ? ["Trace", "Evaluator"]
                        : ["Dataset", "Evaluator"]
                    }
                    targetFields={targetFields}
                    traceMapping={
                      wizardState.task == "real_time"
                        ? traceMappings
                        : undefined
                    }
                    dsl={evaluator?.id ?{
                      sourceOptions: {
                        entry: {
                          label: "Dataset",
                          fields: datasetFields,
                        },
                      },
                      targetId: evaluator?.id ?? "",
                      targetEdges: evaluatorEdges ?? [],
                      setTargetEdges: (mapping) => {
                        console.log('source mapping', mapping);
                        setFirstEvaluatorEdges(mapping);
                      },
                    } : undefined}
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
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};
