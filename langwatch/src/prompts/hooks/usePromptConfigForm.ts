import { zodResolver } from "@hookform/resolvers/zod";
import isEqual from "lodash-es/isEqual";
import { useEffect, useMemo, useRef } from "react";
import { type DeepPartial, useForm } from "react-hook-form";
import { useModelLimits } from "~/hooks/useModelLimits";
import {
  formSchema,
  type PromptConfigFormValues,
  refinedFormSchemaWithModelLimits,
} from "~/prompts";
import { salvageValidData } from "~/utils/zodSalvage";
import { buildDefaultFormValues } from "../utils/buildDefaultFormValues";
import { inputsAndOutputsToDemostrationColumns } from "../utils/llmPromptConfigUtils";

interface UsePromptConfigFormProps {
  configId?: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues = {},
}: UsePromptConfigFormProps) => {
  // Instance-specific flags to prevent sync loops (NOT module-level to avoid cross-instance interference)
  const disableOnChangeRef = useRef(false);
  const disableNodeSyncRef = useRef(false);
  const disableFormSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Store schema in ref so resolver can access it
  const schemaRef = useRef(formSchema);
  /**
   * Parse initial values once with schema defaults applied.
   * Memoized to avoid re-parsing on every render.
   * Uses generic salvage utility to preserve valid parts of corrupted data.
   */
  const defaults = useMemo(() => buildDefaultFormValues(), []);
  const parsedInitialValues = useMemo(() => {
    return salvageValidData(formSchema, initialConfigValues, defaults);
  }, [initialConfigValues, defaults]);

  const methods = useForm<PromptConfigFormValues>({
    /**
     * Use parsed values with defaults applied
     * @see https://react-hook-form.com/docs/useform#defaultValues
     */
    defaultValues: parsedInitialValues,
    resolver: (data, ...args) => {
      // Use ref to get current schema (updated by useEffect)
      return zodResolver(schemaRef.current)(data, ...args);
    },
  });

  const formData = methods.watch();
  const model = formData.version?.configData?.llm?.model;
  const { limits: modelLimits } = useModelLimits({ model });

  const dynamicSchema = useMemo(
    () => refinedFormSchemaWithModelLimits(modelLimits),
    [modelLimits],
  );

  // Update schema ref when limits change
  useEffect(() => {
    schemaRef.current = dynamicSchema as typeof formSchema;

    // Clamp max_tokens to model limit when limits change (prevents validation error)
    if (modelLimits?.maxOutputTokens) {
      const currentMaxTokens = methods.getValues(
        "version.configData.llm.maxTokens",
      );
      if (
        currentMaxTokens !== undefined &&
        currentMaxTokens > modelLimits.maxOutputTokens
      ) {
        methods.setValue(
          "version.configData.llm.maxTokens",
          modelLimits.maxOutputTokens,
          { shouldDirty: false },
        );
      }
    }

    // Re-validate when schema changes
    if (methods.formState.isDirty) {
      void methods.trigger("version.configData.llm");
    }
  }, [dynamicSchema, modelLimits, methods]);
  const messages = methods.watch("version.configData.messages");
  // Messages should always be an array, but we're being defensive here.
  const systemMessage = Array.isArray(messages)
    ? messages.find(({ role }) => role === "system")?.content
    : undefined;

  /**
   * In the case that we're using system messages,
   * make sure to keep the prompt synced
   */
  useEffect(() => {
    if (systemMessage) {
      const currentMessages = methods.getValues("version.configData.messages");
      if (!Array.isArray(currentMessages)) return;

      const currentPrompt = currentMessages.find(
        (msg) => msg.role === "system",
      )?.content;
      // Only sync when value differs; do not mark dirty for this derived update
      if (currentPrompt !== systemMessage) {
        methods.setValue(
          "version.configData.messages",
          currentMessages.map((msg) =>
            msg.role === "system" ? { ...msg, content: systemMessage } : msg,
          ),
          {
            shouldDirty: false,
          },
        );
      }
    }
  }, [systemMessage, messages, methods]);

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
        newColumns,
      );
      methods.setValue(
        "version.configData.demonstrations.inline.records",
        currentRecords,
      );
    }
  }, [formData, methods]);

  // Track current version to detect external upgrades
  const currentVersionRef = useRef(
    parsedInitialValues?.versionMetadata?.versionNumber,
  );

  // Provides forward sync of parent component to form values
  useEffect(() => {
    if (disableNodeSyncRef.current) return;

    const newVersion = parsedInitialValues?.versionMetadata?.versionNumber;
    const currentVersion = currentVersionRef.current;

    // If version changed externally (e.g., upgrade clicked), do a full reset
    if (newVersion !== undefined && newVersion !== currentVersion) {
      currentVersionRef.current = newVersion;
      disableOnChangeRef.current = true;
      methods.reset(parsedInitialValues);
      setTimeout(() => {
        disableOnChangeRef.current = false;
      }, 100); // Longer delay to let debounced updates settle
      return;
    }

    disableOnChangeRef.current = true;
    // Use parsed values to ensure defaults are applied
    for (const [key, value] of Object.entries(
      parsedInitialValues?.version?.configData ?? {},
    )) {
      const currentValue = methods.getValues(
        `version.configData.${key}` as any,
      );
      if (!isEqual(currentValue, value)) {
        methods.setValue(`version.configData.${key}` as any, value as any);
      }
    }
    setTimeout(() => {
      disableOnChangeRef.current = false;
    }, 1);
  }, [parsedInitialValues, methods]);

  // Provides reverse sync of form values to the parent component
  useEffect(() => {
    if (disableOnChangeRef.current) return;
    disableNodeSyncRef.current = true;
    onChange?.(formData);
    if (disableFormSyncTimeoutRef.current) {
      clearTimeout(disableFormSyncTimeoutRef.current);
    }
    disableFormSyncTimeoutRef.current = setTimeout(() => {
      disableNodeSyncRef.current = false;
    }, 1);
  }, [formData, onChange]);

  return {
    methods,
    configId,
  };
};
