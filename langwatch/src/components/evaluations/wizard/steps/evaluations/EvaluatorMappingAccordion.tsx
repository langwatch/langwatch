import { Accordion, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useForm } from "react-hook-form";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import {
  AVAILABLE_EVALUATORS,
  type Evaluators,
} from "~/server/evaluations/evaluators.generated";
import { EvaluatorTracesMapping } from "../../../EvaluatorTracesMapping";
import { useMemo } from "react";
import type { MappingState } from "../../../../../server/tracer/tracesMapping";
import { DEFAULT_MAPPINGS } from "../../../../../server/evaluations/evaluationMappings";

export const EvaluatorMappingAccordion = () => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const evaluator = getFirstEvaluator();
  const evaluatorType = evaluator?.evaluator;
  const evaluatorDefinition = useMemo(() => {
    return evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? AVAILABLE_EVALUATORS[evaluatorType as keyof Evaluators]
      : undefined;
  }, [evaluatorType]);

  const form = useForm<{
    mappings: MappingState;
  }>({
    defaultValues: {
      // It's okay to be empty, TracesMapping will fill it up with default mappings on first render
      mappings: {
        mapping: {},
        expansions: [],
      },
    },
  });

  const mappings = form.watch("mappings");

  const fields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
  }, [evaluatorDefinition]);

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
          {wizardState.task == "real_time" && evaluatorDefinition ? (
            <>
              <Text>
                What data from the real time traces will be used for evaluation?
              </Text>
              <Field.Root>
                <VStack align="start" gap={4} width="full">
                  <EvaluatorTracesMapping
                    titles={["Trace", "Evaluator"]}
                    fields={fields}
                    mappings={mappings}
                    setMapping={(mapping) => {
                      form.setValue("mappings", mapping);
                    }}
                  />
                </VStack>
              </Field.Root>
            </>
          ) : evaluatorDefinition ? (
            <>
              <Text>
                What columns from the dataset should be used for evaluation?
              </Text>
              <Field.Root>
                <VStack align="start" gap={4} width="full">
                  <EvaluatorTracesMapping
                    titles={["Dataset", "Evaluator"]}
                    fields={fields}
                    mappings={mappings}
                    setMapping={(mapping) => {
                      form.setValue("mappings", mapping);
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
