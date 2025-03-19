import { Accordion, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import {
  AVAILABLE_EVALUATORS,
  type Evaluators,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../../../server/evaluations/getEvaluator";
import DynamicZodForm from "../../../../checks/DynamicZodForm";
import type { Field } from "../../../../../optimization_studio/types/dsl";

export const EvaluatorSettingsAccordion = () => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const evaluator = getFirstEvaluator();
  const evaluatorType = evaluator?.evaluator;

  const schema =
    evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? evaluatorsSchema.shape[evaluatorType as keyof Evaluators].shape.settings
      : undefined;

  const hasEvaluatorFields =
    evaluator &&
    evaluatorType &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  const settingsFromParameters = Object.fromEntries(
    (evaluator?.parameters ?? []).map(({ identifier, value }) => [
      identifier,
      value,
    ])
  );

  const defaultSettings:
    | ReturnType<typeof getEvaluatorDefaultSettings>
    | undefined =
    Object.keys(settingsFromParameters).length > 0
      ? (settingsFromParameters as any)
      : evaluatorType
      ? getEvaluatorDefaultSettings(
          AVAILABLE_EVALUATORS[evaluatorType as keyof Evaluators]
        )
      : undefined;

  const form = useForm<{
    settings: typeof defaultSettings;
    customMapping: Record<string, string>;
  }>({
    defaultValues: {
      settings: defaultSettings,
      customMapping: {},
    },
  });

  useEffect(() => {
    if (!defaultSettings) return;

    form.reset({
      settings: defaultSettings,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatorType]);

  const onSubmit = useCallback(
    (data: { settings?: Record<string, any> }) => {
      if (!evaluatorType) return;

      setFirstEvaluator({
        evaluator: evaluatorType,
        parameters: Object.entries(data.settings ?? {}).map(
          ([identifier, value]) =>
            ({
              identifier,
              type: "str",
              value: value,
            }) as Field
        ),
      });
    },
    [evaluatorType, setFirstEvaluator]
  );

  useEffect(() => {
    form.watch(() => {
      console.log(form.getValues());
      void form.handleSubmit(onSubmit)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  return (
    <Accordion.Item
      value="settings"
      width="full"
      hidden={!wizardState.evaluatorCategory || !hasEvaluatorFields}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Evaluator Settings</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent padding={2}>
        <FormProvider {...form}>
          <VStack width="full" gap={3}>
            {hasEvaluatorFields && (
              <DynamicZodForm
                schema={schema}
                evaluatorType={evaluatorType as keyof Evaluators}
                prefix="settings"
                errors={form.formState.errors.settings}
                variant="default"
              />
            )}
          </VStack>
        </FormProvider>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};
