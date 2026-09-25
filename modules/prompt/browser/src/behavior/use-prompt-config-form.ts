import { zodResolver } from "@hookform/resolvers/zod";
import {
  formSchema,
  formSchemaForSave,
  type PromptConfigFormValues,
  refinedFormSchemaWithModelLimits,
} from "@langwatch/prompt-contract";
import isEqual from "lodash-es/isEqual";
import { useEffect, useMemo, useRef } from "react";
import { type DeepPartial, useForm, type UseFormReturn } from "react-hook-form";

import {
  buildDefaultFormValues,
  inputsAndOutputsToDemostrationColumns,
} from "../model/prompt-form/index.ts";
import { salvageValidData } from "../model/zod-salvage.ts";
import { useModelLimits } from "./use-model-limits.ts";

interface UsePromptConfigFormProps {
  configId?: string;
  initialConfigValues?: DeepPartial<PromptConfigFormValues>;
  onChange?: (formValues: PromptConfigFormValues) => void;
}

type PromptConfigForm = UseFormReturn<PromptConfigFormValues>;

/** Clamps max_tokens to the model's output limit, so a limit change raises no validation error. */
function clampMaxTokensToLimit(methods: PromptConfigForm, maxOutputTokens: number | undefined) {
  if (!maxOutputTokens) return;
  const currentMaxTokens = methods.getValues("version.configData.llm.maxTokens");
  if (currentMaxTokens === undefined || currentMaxTokens <= maxOutputTokens) return;
  methods.setValue("version.configData.llm.maxTokens", maxOutputTokens, { shouldDirty: false });
}

/** Keeps the system message in sync with the prompt; a derived update, never marked dirty. */
function syncSystemPrompt(methods: PromptConfigForm, systemMessage: string) {
  const currentMessages = methods.getValues("version.configData.messages");
  if (!Array.isArray(currentMessages)) return;
  const currentPrompt = currentMessages.find((msg) => msg.role === "system")?.content;
  if (currentPrompt === systemMessage) return;
  methods.setValue(
    "version.configData.messages",
    currentMessages.map((msg) =>
      msg.role === "system" ? { ...msg, content: systemMessage } : msg,
    ),
    { shouldDirty: false },
  );
}

/** Keeps the demonstration columns in step with the inputs and outputs. */
function syncDemonstrationColumns(methods: PromptConfigForm, formData: PromptConfigFormValues) {
  const newColumns = inputsAndOutputsToDemostrationColumns(
    formData.version?.configData.inputs ?? [],
    formData.version?.configData.outputs ?? [],
  );
  const inline = formData.version?.configData.demonstrations?.inline;
  const currentColumns = inline?.columnTypes ?? [];
  const currentRecords = inline?.records ?? {};
  if (isEqual(newColumns, currentColumns)) return;
  methods.setValue("version.configData.demonstrations.inline.columnTypes", newColumns);
  methods.setValue("version.configData.demonstrations.inline.records", currentRecords);
}

/** Copies the parent's runtime parameters and config data onto the form where they differ. */
function syncVersionFromParent(methods: PromptConfigForm, parsed: PromptConfigFormValues) {
  const nextRuntimeParameters = parsed?.version?.parameters ?? {};
  if (!isEqual(methods.getValues("version.parameters"), nextRuntimeParameters)) {
    methods.setValue("version.parameters", nextRuntimeParameters);
  }
  const parentConfigData = parsed?.version?.configData;
  if (!parentConfigData) return;
  // Only the keys the parent carries: replacing the whole object erased form-derived keys
  // (demonstrations) and re-rendered forever against the demonstration-columns sync.
  const currentConfigData = methods.getValues("version.configData");
  const nextConfigData = { ...currentConfigData, ...parentConfigData };
  if (!isEqual(currentConfigData, nextConfigData)) {
    methods.setValue("version.configData", nextConfigData);
  }
}

/** Raises a sync-suppression flag for `ms`, so the change it guards does not echo back. */
function suppressFor(flag: { current: boolean }, ms: number) {
  flag.current = true;
  setTimeout(() => {
    flag.current = false;
  }, ms);
}

type SyncFlag = { current: boolean };

/** Forward sync: a parent version change resets the form, otherwise it merges when clean. */
function useSyncFromParent({
  methods,
  parsedInitialValues,
  hasReceivedConfigRef,
  disableNodeSyncRef,
  disableOnChangeRef,
}: {
  methods: PromptConfigForm;
  parsedInitialValues: PromptConfigFormValues;
  hasReceivedConfigRef: SyncFlag;
  disableNodeSyncRef: SyncFlag;
  disableOnChangeRef: SyncFlag;
}) {
  // Track current version to detect external upgrades
  const currentVersionRef = useRef(parsedInitialValues?.versionMetadata?.versionNumber);

  // Provides forward sync of parent component to form values
  useEffect(() => {
    if (disableNodeSyncRef.current) return;
    // Don't forward-sync until we've received real config values.
    // Without this guard, the forward sync can push default placeholder
    // values (e.g. "input") onto a form that PromptEditorDrawer has
    // already reset with the real config (e.g. "llm_output").
    if (!hasReceivedConfigRef.current) return;

    const newVersion = parsedInitialValues?.versionMetadata?.versionNumber;
    const currentVersion = currentVersionRef.current;

    // If version changed externally (e.g., upgrade clicked), do a full reset
    if (newVersion !== undefined && newVersion !== currentVersion) {
      currentVersionRef.current = newVersion;
      // Longer hold, to let debounced updates settle.
      suppressFor(disableOnChangeRef, 100);
      methods.reset(parsedInitialValues);
      return;
    }

    // Don't overwrite user edits while the form is dirty. The debounced
    // reverse sync will eventually write the user's changes to the store;
    // once the store catches up, parsedInitialValues will reflect the
    // user's values and the field-level sync becomes a no-op.
    if (methods.formState.isDirty) return;

    suppressFor(disableOnChangeRef, 1);
    syncVersionFromParent(methods, parsedInitialValues);
  }, [parsedInitialValues, methods, hasReceivedConfigRef, disableNodeSyncRef, disableOnChangeRef]);
}

/** Reverse sync: form edits flow to the parent while the forward sync is held off. */
function useSyncToParent({
  formData,
  onChange,
  disableOnChangeRef,
  disableNodeSyncRef,
}: {
  formData: PromptConfigFormValues;
  onChange: UsePromptConfigFormProps["onChange"];
  disableOnChangeRef: SyncFlag;
  disableNodeSyncRef: SyncFlag;
}) {
  const disableFormSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
  }, [formData, onChange, disableNodeSyncRef, disableOnChangeRef]);
}

export const usePromptConfigForm = ({
  configId,
  onChange,
  initialConfigValues = {},
}: UsePromptConfigFormProps) => {
  // Instance-specific flags to prevent sync loops (not module-level, to avoid cross-instance
  // interference)
  const disableOnChangeRef = useRef(false);
  const disableNodeSyncRef = useRef(false);

  // Track whether we've received meaningful config values (not just empty defaults).
  // The forward sync must not push default form values onto a form that has already
  // been reset with real data by PromptEditorDrawer's init effect.
  const hasReceivedConfigRef = useRef(Object.keys(initialConfigValues).length > 0);
  useEffect(() => {
    if (Object.keys(initialConfigValues).length > 0) {
      hasReceivedConfigRef.current = true;
    }
  }, [initialConfigValues]);

  // Store schema in ref so resolver can access it.
  // Uses the save-time schema so the system-prompt-required refinement
  // (#3196) fires when methods.trigger() is called from the Save handler.
  const schemaRef = useRef(formSchemaForSave);
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
    resolver: (data, context, options) => {
      // Use ref to get current schema (updated by useEffect). The schema
      // validates PromptConfigFormValues while preserving the schema's exact
      // Zod 4 input and output types.
      const resolver = zodResolver(schemaRef.current);
      return resolver(data, context, options);
    },
  });

  const formData = methods.watch();
  const model = formData.version?.configData?.llm?.model;
  const { limits: modelLimits } = useModelLimits({ model });

  const dynamicSchema = useMemo(() => refinedFormSchemaWithModelLimits(modelLimits), [modelLimits]);

  // Update schema ref when limits change
  useEffect(() => {
    schemaRef.current = dynamicSchema;

    clampMaxTokensToLimit(methods, modelLimits?.maxOutputTokens);

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
    if (systemMessage) syncSystemPrompt(methods, systemMessage);
  }, [systemMessage, messages, methods]);

  // Handle syncing the inputs/outputs with the demonstrations columns
  useEffect(() => {
    syncDemonstrationColumns(methods, formData);
  }, [formData, methods]);

  useSyncFromParent({
    methods,
    parsedInitialValues,
    hasReceivedConfigRef,
    disableNodeSyncRef,
    disableOnChangeRef,
  });
  useSyncToParent({ formData, onChange, disableOnChangeRef, disableNodeSyncRef });

  return {
    methods,
    configId,
  };
};
