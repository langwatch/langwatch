import type { Node } from "@xyflow/react";
import type { Evaluator } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { z } from "zod";
import { FormProvider, useForm } from "react-hook-form";
import DynamicZodForm from "../../../components/checks/DynamicZodForm";
import {
  AVAILABLE_EVALUATORS,
  type Evaluators,
} from "../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../server/evaluations/evaluators.zod.generated";
import { VStack } from "@chakra-ui/react";

export function EvaluatorPropertiesPanel({ node }: { node: Node<Evaluator> }) {
  const form = useForm();
  const evaluator = node.data.evaluator;

  const schema =
    evaluator && evaluator in AVAILABLE_EVALUATORS
      ? evaluatorsSchema.shape[evaluator as keyof Evaluators].shape.settings
      : undefined;

  return (
    <BasePropertiesPanel node={node} inputsReadOnly outputsReadOnly>
      {evaluator &&
        schema instanceof z.ZodObject &&
        Object.keys(schema.shape).length > 0 && (
          <FormProvider {...form}>
            <VStack width="full" spacing={3}>
              <DynamicZodForm
                schema={schema}
                evaluatorType={evaluator as keyof Evaluators}
                prefix="settings"
                // errors={form.formState.errors}
                errors={undefined}
                variant="studio"
              />
            </VStack>
          </FormProvider>
        )}
    </BasePropertiesPanel>
  );
}
