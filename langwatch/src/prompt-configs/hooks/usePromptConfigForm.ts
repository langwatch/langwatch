import { zodResolver } from "@hookform/resolvers/zod";
import isEqual from "lodash-es/isEqual";
import { useEffect } from "react";
import { useForm, type DeepPartial } from "react-hook-form";
import { type z } from "zod";

import { inputsAndOutputsToDemostrationColumns } from "../llmPromptConfigUtils";

import { usePromptHandleCheck } from "~/hooks/prompts/usePromptHandleCheck";
import {
  createPromptConfigSchemaWithValidators,
  type formSchema,
} from "~/prompt-configs/schemas";

export type PromptConfigFormValues = z.infer<typeof formSchema>;

interface UsePromptConfigFormProps {
  configId: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

let disableOnChange = false;
let disableNodeSync = false;
let disableFormSyncTimeout: NodeJS.Timeout | null = null;

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues = {},
}: UsePromptConfigFormProps) => {
  const { checkHandleUniqueness } = usePromptHandleCheck();

  const methods = useForm<PromptConfigFormValues>({
    /**
     * Don't pass undefined as defaultValue
     * @see https://react-hook-form.com/docs/useform#defaultValues
     */
    defaultValues: initialConfigValues,
    resolver: (data, ...args) => {
      return zodResolver(
        createPromptConfigSchemaWithValidators({
          configId,
          checkHandleUniqueness,
        })
      )(data, ...args);
    },
  });

  const formData = methods.watch();

  // Handle syncing the inputs/outputs with the demonstrations columns
  useEffect(() => {
    const inputs = formData.version?.configData.inputs ?? [];
    const outputs = formData.version?.configData.outputs ?? [];
    const newColumns = inputsAndOutputsToDemostrationColumns(inputs, outputs);
    const currentColumns =
      formData.version?.configData.demonstrations?.inline?.columnTypes ?? [];
    const currentRecords =
      formData.version?.configData.demonstrations?.inline?.records ?? {};

    if (!isEqual(newColumns, currentColumns)) {
      methods.setValue(
        "version.configData.demonstrations.inline.columnTypes",
        newColumns
      );
      methods.setValue(
        "version.configData.demonstrations.inline.records",
        currentRecords
      );
    }
  }, [formData, methods]);

  // Provides forward sync of parent component to form values
  useEffect(() => {
    if (disableNodeSync) return;
    disableOnChange = true;
    for (const [key, value] of Object.entries(
      initialConfigValues?.version?.configData ?? {}
    )) {
      const currentValue = methods.getValues(
        `version.configData.${key}` as any
      );
      if (!isEqual(currentValue, value)) {
        methods.setValue(`version.configData.${key}` as any, value as any);
      }
    }
    setTimeout(() => {
      disableOnChange = false;
    }, 1);
  }, [initialConfigValues, methods]);

  // Provides reverse sync of form values to the parent component
  useEffect(() => {
    if (disableOnChange) return;
    disableNodeSync = true;
    onChange?.(formData);
    if (disableFormSyncTimeout) {
      clearTimeout(disableFormSyncTimeout);
    }
    disableFormSyncTimeout = setTimeout(() => {
      disableNodeSync = false;
    }, 1);
  }, [formData, onChange]);

  return {
    methods,
    configId,
  };
};
