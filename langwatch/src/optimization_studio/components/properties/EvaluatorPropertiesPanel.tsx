import type { Node } from "@xyflow/react";
import type { Evaluator, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { z } from "zod";
import { FormProvider, useForm } from "react-hook-form";
import DynamicZodForm from "../../../components/checks/DynamicZodForm";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../server/evaluations/evaluators.zod.generated";
import { VStack } from "@chakra-ui/react";
import { useCallback, useEffect } from "react";
import { getEvaluatorDefaultSettings } from "../../../server/evaluations/getEvaluator";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { useDebouncedCallback } from "use-debounce";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { usePublicEnv } from "../../../hooks/usePublicEnv";

export function EvaluatorPropertiesPanel({ node }: { node: Node<Evaluator> }) {
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const settingsFromParameters = Object.fromEntries(
    (node.data.parameters ?? []).map(({ identifier, value }) => [
      identifier,
      value,
    ])
  );
  const form = useForm({
    defaultValues: {
      settings: settingsFromParameters,
    },
  });

  const evaluator = node.data.evaluator;

  const schema =
    evaluator && evaluator in AVAILABLE_EVALUATORS
      ? evaluatorsSchema.shape[evaluator as EvaluatorTypes]?.shape.settings
      : undefined;

  const availableEvaluators = useAvailableEvaluators();

  useEffect(() => {
    if (!evaluator || !(evaluator in availableEvaluators)) return;
    if (node.data.parameters) return;

    const evaluatorDefinition =
      availableEvaluators[evaluator as EvaluatorTypes];

    const setDefaultSettings = (
      defaultValues: Record<string, any>,
      prefix: string
    ) => {
      if (!defaultValues) return;

      Object.entries(defaultValues).forEach(([key, value]) => {
        if (
          typeof value === "object" &&
          !Array.isArray(value) &&
          value !== null
        ) {
          setDefaultSettings(value, `${prefix}.${key}`);
        } else {
          //@ts-ignore
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultSettings(
      getEvaluatorDefaultSettings(
        evaluatorDefinition,
        project,
        publicEnv.data?.IS_ATLA_DEFAULT_JUDGE
      ),
      "settings"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluator]);

  const onSubmit = useCallback(
    (data: { settings: Record<string, any> }) => {
      setNode({
        id: node.id,
        data: {
          parameters: Object.entries(data.settings).map(
            ([identifier, value]) =>
              ({
                identifier,
                type: "str",
                value: value,
              }) as Field
          ),
        },
      });
    },
    [node.id, setNode]
  );

  const handleSubmit_ = useCallback(() => {
    void form.handleSubmit(onSubmit)();
  }, [form, onSubmit]);

  const handleSubmitDebounced = useDebouncedCallback(handleSubmit_, 100);
  useEffect(() => {
    form.watch(() => {
      handleSubmitDebounced();
    });
  }, [form, handleSubmitDebounced]);

  const hasEvaluatorFields =
    evaluator &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  return (
    <BasePropertiesPanel
      node={node}
      hideInputs
      hideOutputs
      hideParameters={!!hasEvaluatorFields}
    >
      {hasEvaluatorFields && schema && (
        <FormProvider {...form}>
          <VStack width="full" gap={3}>
            <DynamicZodForm
              schema={schema}
              evaluatorType={evaluator as EvaluatorTypes}
              prefix="settings"
              errors={form.formState.errors.settings}
              variant="studio"
            />
          </VStack>
        </FormProvider>
      )}
    </BasePropertiesPanel>
  );
}
