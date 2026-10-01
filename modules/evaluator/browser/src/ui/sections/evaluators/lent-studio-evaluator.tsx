/** Evaluator's editor and settings form, lent to the studio (ARCHITECTURE.md §3.4, rule 7). */

import type {
  UiEvaluatorEditorValues,
  UiEvaluatorSettingsFormProps,
  UiStudioEvaluatorEditorProps,
} from "@langwatch/browser-host/declarations";
import { VStack } from "@langwatch/design-system/primitives";
import { evaluatorSettingsSchemaFor } from "@langwatch/evaluator-contract";
import { useEffect, useRef } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import DynamicZodForm from "../checks/dynamic-zod-form.tsx";
import { EvaluatorEditorContent } from "./evaluator-editor-content.tsx";
import { useEvaluatorDefaultSettings } from "./use-evaluator-default-settings.ts";

function settingsSchemaOf(evaluatorType: string | undefined) {
  if (!evaluatorType) return undefined;
  const lookup = evaluatorSettingsSchemaFor(evaluatorType);
  return lookup.found ? lookup.schema : undefined;
}

/** The latest value, readable from a subscription without resubscribing on each render. */
function useLatest<Value>(value: Value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function LentStudioEvaluatorEditor(props: UiStudioEvaluatorEditorProps) {
  const form = useForm<UiEvaluatorEditorValues>({ defaultValues: props.initialValues });
  const onChangeRef = useLatest(props.onChange);
  useEffect(() => {
    const subscription = form.watch(() => onChangeRef.current(form.getValues()));
    return () => subscription.unsubscribe();
  }, [form, onChangeRef]);
  const settingsSchema = settingsSchemaOf(props.evaluatorType);
  const hasSettings =
    settingsSchema instanceof z.ZodObject && Object.keys(settingsSchema.shape).length > 0;

  return (
    <EvaluatorEditorContent
      evaluatorType={props.evaluatorType}
      description={props.description}
      isWorkflowEvaluator={props.isWorkflowEvaluator}
      workflow={props.workflow}
      form={form}
      settingsSchema={settingsSchema}
      hasSettings={hasSettings}
      effectiveEvaluatorDef={props.fields}
      mappingsConfig={props.mappings}
      variant="studio"
    />
  );
}

type SettingsValues = { settings: Record<string, unknown> };

export function LentEvaluatorSettingsForm({
  evaluatorType,
  initialSettings,
  applyDefaults,
  onChange,
}: UiEvaluatorSettingsFormProps) {
  const form = useForm<SettingsValues>({ defaultValues: { settings: initialSettings } });
  const onChangeRef = useLatest(onChange);
  useEffect(() => {
    const subscription = form.watch(() => onChangeRef.current(form.getValues().settings));
    return () => subscription.unsubscribe();
  }, [form, onChangeRef]);
  useEvaluatorDefaultSettings({ form, evaluatorType, enabled: applyDefaults });
  const settingsSchema = settingsSchemaOf(evaluatorType);
  if (!(settingsSchema instanceof z.ZodObject) || Object.keys(settingsSchema.shape).length === 0) {
    return null;
  }

  return (
    <FormProvider {...form}>
      <VStack width="full" gap={3}>
        <DynamicZodForm
          schema={settingsSchema}
          evaluatorType={evaluatorType}
          prefix="settings"
          errors={form.formState.errors.settings}
          variant="studio"
        />
      </VStack>
    </FormProvider>
  );
}
