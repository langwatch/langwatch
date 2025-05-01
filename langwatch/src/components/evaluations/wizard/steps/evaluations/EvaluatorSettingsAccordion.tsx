import { VStack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { evaluatorsSchema } from "../../../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../../../server/evaluations/getEvaluator";
import DynamicZodForm from "../../../../checks/DynamicZodForm";
import type { Field } from "../../../../../optimization_studio/types/dsl";
import { StepAccordion } from "../../components/StepAccordion";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useAvailableEvaluators } from "../../../../../hooks/useAvailableEvaluators";
import type { EvaluatorTypes } from "../../../../../server/evaluations/evaluators.generated";
import { usePublicEnv } from "../../../../../hooks/usePublicEnv";

export const EvaluatorSettingsAccordion = () => {
  const { project } = useOrganizationTeamProject();
  const { wizardState, getFirstEvaluatorNode, setFirstEvaluator } =
    useEvaluationWizardStore();
  const publicEnv = usePublicEnv();

  const evaluator = getFirstEvaluatorNode();
  const evaluatorType = evaluator?.data.evaluator;
  const availableEvaluators = useAvailableEvaluators();

  const schema =
    evaluatorType && evaluatorType in availableEvaluators
      ? evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape.settings
      : undefined;

  const hasEvaluatorFields =
    evaluator &&
    evaluatorType &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  const settingsFromParameters = Object.fromEntries(
    (evaluator?.data.parameters ?? []).map(({ identifier, value }) => [
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
          availableEvaluators[evaluatorType as EvaluatorTypes],
          project,
          publicEnv.data?.IS_ATLA_DEFAULT_JUDGE
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

  const onSubmit = useCallback(
    (data: { settings?: Record<string, any> }) => {
      if (!evaluatorType) return;

      // This updates the evaluator node with the settings
      setFirstEvaluator(
        {
          evaluator: evaluatorType,
          parameters: Object.entries(data.settings ?? {}).map(
            ([identifier, value]) =>
              ({
                identifier,
                type: "str",
                value: value,
              }) as Field
          ),
        },
        availableEvaluators
      );
    },
    [availableEvaluators, evaluatorType, setFirstEvaluator]
  );

  useEffect(() => {
    if (!defaultSettings) return;

    form.reset({
      settings: defaultSettings,
    });
    onSubmit({ settings: defaultSettings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatorType]);

  const formRenderedFor = useRef<string>(evaluatorType);

  useEffect(() => {
    formRenderedFor.current = undefined;
    setTimeout(() => {
      formRenderedFor.current = evaluatorType ?? "";
    }, 300);
  }, [evaluatorType]);

  useEffect(() => {
    const watcher = form.watch(() => {
      if (!formRenderedFor.current) return;
      void form.handleSubmit(onSubmit)();
    });
    return () => {
      watcher.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, onSubmit]);

  return (
    <StepAccordion
      value="settings"
      width="full"
      borderColor="green.400"
      title="Evaluator Settings"
      showTrigger={!!wizardState.evaluatorCategory && !!hasEvaluatorFields}
      indicatorProps={{
        id: "js-expand-settings-button",
        focusRing: "outside",
      }}
    >
      <FormProvider {...form}>
        <VStack width="full" gap={3}>
          {hasEvaluatorFields && schema && (
            <DynamicZodForm
              schema={schema}
              evaluatorType={evaluatorType as EvaluatorTypes}
              prefix="settings"
              errors={form.formState.errors.settings}
              variant="default"
            />
          )}
          {!schema && (
            <Text>This evaluator does not have any settings to configure.</Text>
          )}
        </VStack>
      </FormProvider>
    </StepAccordion>
  );
};
