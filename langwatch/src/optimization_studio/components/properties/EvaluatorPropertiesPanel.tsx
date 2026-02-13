import { HStack, Spinner, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { z } from "zod";
import DynamicZodForm from "../../../components/checks/DynamicZodForm";
import { EvaluatorEditorContent } from "../../../components/evaluators/EvaluatorEditorContent";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../server/evaluations/getEvaluator";
import { api } from "../../../utils/api";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Evaluator, Field } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * Checks whether the evaluator string uses the new DB-backed format (`evaluators/<id>`).
 */
function isDbEvaluatorRef(evaluator: string | undefined): boolean {
  return !!evaluator?.startsWith("evaluators/");
}

/**
 * Extracts the evaluator DB ID from a `evaluators/<id>` reference.
 */
function extractEvaluatorId(evaluator: string): string {
  return evaluator.replace("evaluators/", "");
}

/**
 * Properties panel for evaluator nodes in the optimization studio.
 *
 * Supports two formats:
 * - New format: `evaluators/<id>` -- fetches evaluator from DB, renders EvaluatorEditorContent
 * - Old format: direct type like `langevals/exact_match` -- inline DynamicZodForm (backward compat)
 */
export function EvaluatorPropertiesPanel({ node }: { node: Node<Evaluator> }) {
  const evaluator = node.data.evaluator;

  if (isDbEvaluatorRef(evaluator)) {
    return <DbEvaluatorPanel node={node} evaluatorRef={evaluator!} />;
  }

  return <InlineEvaluatorPanel node={node} />;
}

// ---------------------------------------------------------------------------
// New format: DB-backed evaluator panel
// ---------------------------------------------------------------------------

function DbEvaluatorPanel({
  node,
  evaluatorRef,
}: {
  node: Node<Evaluator>;
  evaluatorRef: string;
}) {
  const { project } = useOrganizationTeamProject();
  const evaluatorId = extractEvaluatorId(evaluatorRef);

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId, projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const updateMutation = api.evaluators.update.useMutation();

  const config = evaluatorQuery.data?.config as {
    evaluatorType?: string;
    settings?: Record<string, unknown>;
  } | null;

  const evaluatorType = config?.evaluatorType;

  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    return evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape
      ?.settings;
  }, [evaluatorType]);

  const hasSettings =
    !!settingsSchema &&
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

  const effectiveEvaluatorDef = useMemo(() => {
    const fields = evaluatorQuery.data?.fields;
    if (fields && fields.length > 0) {
      const requiredFields = fields
        .filter((f) => !f.optional)
        .map((f) => f.identifier);
      const optionalFields = fields
        .filter((f) => f.optional)
        .map((f) => f.identifier);
      return { requiredFields, optionalFields };
    }
    return evaluatorDef;
  }, [evaluatorQuery.data?.fields, evaluatorDef]);

  const isWorkflowEvaluator = evaluatorQuery.data?.type === "workflow";

  const workflow =
    isWorkflowEvaluator && evaluatorQuery.data?.workflowId
      ? {
          id: evaluatorQuery.data.workflowId,
          name: evaluatorQuery.data.workflowName ?? "Workflow",
          icon: evaluatorQuery.data.workflowIcon,
          updatedAt: evaluatorQuery.data.updatedAt,
          projectSlug: project?.slug ?? "",
        }
      : undefined;

  // Form for name + settings
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
    defaultValues: {
      name: evaluatorQuery.data?.name ?? "",
      settings: config?.settings ?? {},
    },
  });

  // Reset form when evaluator data loads
  useEffect(() => {
    if (evaluatorQuery.data) {
      const loadedConfig = evaluatorQuery.data.config as {
        settings?: Record<string, unknown>;
      } | null;
      form.reset({
        name: evaluatorQuery.data.name,
        settings: loadedConfig?.settings ?? {},
      });
    }
  }, [evaluatorQuery.data, form]);

  // Debounced save to DB
  const saveToDb = useCallback(
    (formValues: { name: string; settings: Record<string, unknown> }) => {
      if (!project?.id || !evaluatorType) return;

      updateMutation.mutate({
        id: evaluatorId,
        projectId: project.id,
        name: formValues.name.trim(),
        config: {
          evaluatorType,
          settings: formValues.settings,
        },
      });
    },
    [project?.id, evaluatorId, evaluatorType, updateMutation],
  );

  const debouncedSave = useDebouncedCallback(saveToDb, 500, {
    leading: false,
    trailing: true,
  });

  // Watch form changes and auto-save
  useEffect(() => {
    const subscription = form.watch((formValues) => {
      if (formValues.name !== undefined && formValues.settings !== undefined) {
        debouncedSave(
          formValues as { name: string; settings: Record<string, unknown> },
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [form, debouncedSave]);

  if (evaluatorQuery.isLoading) {
    return (
      <BasePropertiesPanel node={node}>
        <HStack justify="center" paddingY={8} width="full">
          <Spinner size="md" />
        </HStack>
      </BasePropertiesPanel>
    );
  }

  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      inputsReadOnly
      outputsReadOnly
    >
      <EvaluatorEditorContent
        evaluatorType={evaluatorType}
        description={evaluatorDef?.description}
        isWorkflowEvaluator={isWorkflowEvaluator}
        workflow={workflow}
        form={form}
        settingsSchema={settingsSchema}
        hasSettings={hasSettings}
        effectiveEvaluatorDef={effectiveEvaluatorDef}
        variant="studio"
      />
    </BasePropertiesPanel>
  );
}

// ---------------------------------------------------------------------------
// Old format: inline evaluator panel (backward compatibility)
// ---------------------------------------------------------------------------

function InlineEvaluatorPanel({ node }: { node: Node<Evaluator> }) {
  const { project } = useOrganizationTeamProject();
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const settingsFromParameters = Object.fromEntries(
    (node.data.parameters ?? []).map(({ identifier, value }) => [
      identifier,
      value,
    ]),
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
    if (
      !evaluator ||
      !availableEvaluators ||
      !(evaluator in availableEvaluators)
    )
      return;
    if (node.data.parameters) return;

    const evaluatorDefinition =
      availableEvaluators[evaluator as EvaluatorTypes];

    const setDefaultSettings = (
      defaultValues: Record<string, any>,
      prefix: string,
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
      getEvaluatorDefaultSettings(evaluatorDefinition, project),
      "settings",
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
              }) as Field,
          ),
        },
      });
    },
    [node.id, setNode],
  );

  const handleSubmit_ = useCallback(() => {
    void form.handleSubmit(onSubmit)();
  }, [form, onSubmit]);

  const handleSubmitDebounced = useDebouncedCallback(handleSubmit_, 100, {
    leading: true,
    trailing: false,
  });

  useEffect(() => {
    const subscription = form.watch(() => {
      handleSubmitDebounced();
    });

    return () => subscription.unsubscribe();
  }, [form, handleSubmitDebounced]);

  const hasEvaluatorFields =
    evaluator &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  return (
    <BasePropertiesPanel node={node} hideParameters={!!hasEvaluatorFields}>
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
