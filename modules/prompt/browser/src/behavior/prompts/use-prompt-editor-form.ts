import type { LocalPromptConfig } from "@langwatch/experiment-contract";
import type { ModelMetadataForFrontend } from "@langwatch/model-provider-contract";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import { type AvailableSource, type FieldMapping } from "@langwatch/workflow-contract";
import debounce from "lodash-es/debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getMaxTokenLimit } from "../../model/max-token-limit.ts";
import { localConfigToFormValues } from "../../model/prompts/local-config-to-form-values.ts";
import {
  autoMappingsFor,
  extractLocalConfig,
  isUnsavedFormValues,
  mergeConfigOverDefaults,
  mergeLocalOverServer,
} from "../../model/prompts/prompt-editor-values.ts";
import {
  areFormValuesEqual,
  buildDefaultFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../../prompt-form.ts";
import { usePromptConfigForm } from "../use-prompt-config-form.ts";

type OnMappingChange = (identifier: string, mapping: FieldMapping | undefined) => void;

/**
 * The drawer's own copy of the input mappings: the single source of truth
 * inside it, re-seeded when the caller's mappings change, and every edit
 * handed back to the caller to persist.
 */
export function useEditorInputMappings({
  fromProps,
  onChangeProp,
}: {
  fromProps: Record<string, FieldMapping> | undefined;
  onChangeProp: OnMappingChange | undefined;
}) {
  const [inputMappings, setInputMappings] = useState(fromProps);

  const [mappingsFrom, setMappingsFrom] = useState(fromProps);
  if (mappingsFrom !== fromProps) {
    setMappingsFrom(fromProps);
    setInputMappings(fromProps);
  }

  const onInputMappingsChange = useCallback<OnMappingChange>(
    (identifier, mapping) => {
      setInputMappings((prev) => {
        const { [identifier]: _replaced, ...rest } = prev ?? {};
        return mapping ? { ...rest, [identifier]: mapping } : rest;
      });
      onChangeProp?.(identifier, mapping);
    },
    [onChangeProp],
  );

  return { inputMappings, setInputMappings, onInputMappingsChange };
}

type EditorFormInput = {
  isOpen: boolean;
  promptId: string | undefined;
  promptVersionId: string | undefined;
  targetId: string | undefined;
  prompt: {
    data:
      | Parameters<typeof versionedPromptToPromptConfigFormValuesWithSystemMessage>[0]
      | null
      | undefined;
    isLoading: boolean;
  };
  initialLocalConfig: LocalPromptConfig | undefined;
  inlineConfigFallback: LocalPromptConfig | undefined;
  modelMetadata: Record<string, ModelMetadataForFrontend> | undefined;
  resolvedDefaultModel: string | undefined;
  onLocalConfigChange: ((config: LocalPromptConfig | undefined) => void) | undefined;
  availableSources: AvailableSource[] | undefined;
  onMappingsChangeProp: OnMappingChange | undefined;
  setInputMappings: React.Dispatch<React.SetStateAction<Record<string, FieldMapping> | undefined>>;
};

/** The new-prompt baseline: the default model at its token ceiling, the node's config over it. */
function unstoredPromptValues(input: EditorFormInput): {
  formValues: PromptConfigFormValues;
  defaultInputs: PromptConfigFormValues["version"]["configData"]["inputs"];
} {
  const defaultModel = input.resolvedDefaultModel ?? "";
  const defaults = buildDefaultFormValues({
    version: {
      configData: {
        llm: {
          model: defaultModel,
          maxTokens: getMaxTokenLimit(
            defaultModel ? input.modelMetadata?.[defaultModel] : undefined,
          ),
        },
      },
    },
  });
  // Genuine unpublished edits first, then the fallback (only set when the
  // prompt was not found in the project), so imported workflows keep theirs.
  const formValues = mergeConfigOverDefaults({
    defaults,
    config: input.initialLocalConfig ?? input.inlineConfigFallback,
  });
  return { formValues, defaultInputs: defaults.version.configData.inputs };
}

/**
 * Maps the default inputs to dataset columns of the same name, locally and
 * through the caller, when this drawer serves a mapping context.
 */
function autoMapDefaultInputs({
  input,
  inputs,
}: {
  input: EditorFormInput;
  inputs: readonly { identifier: string }[];
}): void {
  const { availableSources, onMappingsChangeProp, setInputMappings } = input;
  if (!availableSources || availableSources.length === 0 || !onMappingsChangeProp) return;
  for (const { identifier, mapping } of autoMappingsFor({ inputs, availableSources })) {
    setInputMappings((prev) => ({ ...prev, [identifier]: mapping }));
    onMappingsChangeProp(identifier, mapping);
  }
}

/**
 * Hands the bridge the full config once the watch subscription has settled
 * (reset fires it synchronously, possibly clearing), then clears it again
 * when there were no unpublished edits to keep.
 */
function syncBridgeAfterInit({
  formValues,
  hasLocalEdits,
  onLocalConfigChangeRef,
}: {
  formValues: PromptConfigFormValues;
  hasLocalEdits: boolean;
  onLocalConfigChangeRef: React.RefObject<EditorFormInput["onLocalConfigChange"]>;
}): void {
  const config = extractLocalConfig(formValues);
  queueMicrotask(() => {
    onLocalConfigChangeRef.current?.(config);
    if (!hasLocalEdits) {
      queueMicrotask(() => onLocalConfigChangeRef.current?.(undefined));
    }
  });
}

type FormMethods = ReturnType<typeof usePromptConfigForm>["methods"];

/**
 * What the form's effects and its watch share without re-rendering. Written
 * directly (init/reset, render), never mirrored from state: batching would let
 * the reset effect override init's `true` on mount.
 */
type EditorRefs = {
  isFormInitialized: React.RefObject<boolean>;
  onLocalConfigChange: React.RefObject<EditorFormInput["onLocalConfigChange"]>;
  // Synced in an effect, not per render, so a save's fresh values survive stale query data.
  savedFormValues: React.RefObject<PromptConfigFormValues | undefined>;
  promptId: React.RefObject<string | undefined>;
  // The target the form was initialised for: the callback ref updates during
  // render, before the form holds the new target's values.
  initializedTargetId: React.RefObject<string | undefined>;
  targetId: React.RefObject<string | undefined>;
};

/** One stable set of refs for the form's life; the per-render ones are refreshed here. */
function useEditorRefs({
  input,
  savedFormValues,
}: {
  input: EditorFormInput;
  savedFormValues: PromptConfigFormValues | undefined;
}): EditorRefs {
  const [refs] = useState<EditorRefs>(() => ({
    isFormInitialized: { current: false },
    onLocalConfigChange: { current: input.onLocalConfigChange },
    savedFormValues: { current: savedFormValues },
    promptId: { current: input.promptId },
    initializedTargetId: { current: undefined },
    targetId: { current: input.targetId },
  }));
  refs.onLocalConfigChange.current = input.onLocalConfigChange;
  refs.promptId.current = input.promptId;
  refs.targetId.current = input.targetId;
  return refs;
}

/** Initialises the form once the drawer is open and the stored prompt or defaults can seed it. */
function useEditorFormInit({
  input,
  methods,
  refs,
  isNewOrNotFoundPrompt,
  initialized,
}: {
  input: EditorFormInput;
  methods: FormMethods;
  refs: EditorRefs;
  isNewOrNotFoundPrompt: boolean;
  initialized: {
    value: boolean;
    set: (value: boolean) => void;
    setConfigValues: (values: PromptConfigFormValues) => void;
  };
}) {
  const {
    isOpen,
    promptId,
    promptVersionId,
    targetId,
    prompt: { data: promptData, isLoading: promptLoading },
    initialLocalConfig,
    inlineConfigFallback,
    modelMetadata,
    resolvedDefaultModel,
    onLocalConfigChange,
    availableSources,
    onMappingsChangeProp,
    setInputMappings,
  } = input;
  const { value: isFormInitialized, set: setIsFormInitialized, setConfigValues } = initialized;

  useEffect(() => {
    if (isFormInitialized || !isOpen) return;
    if (!promptData && !(isNewOrNotFoundPrompt && modelMetadata)) return;

    const context: EditorFormInput = {
      isOpen,
      promptId,
      promptVersionId,
      targetId,
      prompt: { data: promptData, isLoading: promptLoading },
      initialLocalConfig,
      inlineConfigFallback,
      modelMetadata,
      resolvedDefaultModel,
      onLocalConfigChange,
      availableSources,
      onMappingsChangeProp,
      setInputMappings,
    };
    const serverValues = promptData
      ? versionedPromptToPromptConfigFormValuesWithSystemMessage(promptData)
      : undefined;
    const { formValues, defaultInputs } = serverValues
      ? { formValues: mergeLocalOverServer({ serverValues, local: initialLocalConfig }) }
      : unstoredPromptValues(context);

    setConfigValues(formValues);
    // The saved reference is the SERVER's values, so local edits stay unsaved;
    // with no stored prompt the baseline itself is the reference.
    refs.savedFormValues.current = serverValues ?? formValues;
    // Before reset: it fires the watch synchronously, which must see the form initialised.
    refs.isFormInitialized.current = true;
    methods.reset(formValues);
    refs.initializedTargetId.current = targetId;
    setIsFormInitialized(true);

    if (defaultInputs) {
      autoMapDefaultInputs({ input: context, inputs: defaultInputs });
    } else if (onLocalConfigChange) {
      syncBridgeAfterInit({
        formValues,
        hasLocalEdits: !!initialLocalConfig,
        onLocalConfigChangeRef: refs.onLocalConfigChange,
      });
    }
  }, [
    isOpen,
    promptData,
    promptLoading,
    isNewOrNotFoundPrompt,
    promptId,
    promptVersionId,
    initialLocalConfig,
    inlineConfigFallback,
    methods,
    isFormInitialized,
    setIsFormInitialized,
    setConfigValues,
    availableSources,
    onMappingsChangeProp,
    setInputMappings,
    modelMetadata,
    resolvedDefaultModel,
    onLocalConfigChange,
    targetId,
    refs,
  ]);
}

/** Re-arms initialisation when the drawer closes, and on a new prompt, version or target. */
function useFormRearm({
  input,
  refs,
  setIsFormInitialized,
}: {
  input: EditorFormInput;
  refs: EditorRefs;
  setIsFormInitialized: (value: boolean) => void;
}) {
  const { isOpen, promptId, promptVersionId, targetId } = input;

  useEffect(() => {
    if (isOpen) return;
    refs.isFormInitialized.current = false;
    setIsFormInitialized(false);
  }, [isOpen, refs, setIsFormInitialized]);

  // Skips mount, where its `false` would batch with init's `true` and win.
  const promptResetMountRef = useRef(true);
  useEffect(() => {
    if (promptResetMountRef.current) {
      promptResetMountRef.current = false;
      return;
    }
    refs.isFormInitialized.current = false;
    setIsFormInitialized(false);
  }, [promptId, promptVersionId, targetId, refs, setIsFormInitialized]);
}

type DebouncedLocalConfig = ((config: LocalPromptConfig | undefined) => void) & {
  cancel: () => void;
  flush: () => void;
};

/**
 * One change of the watched form: tracks unsaved changes and feeds the
 * caller's local config, debounced, clearing it when back at the saved state.
 */
function onFormValuesChanged({
  formValues,
  refs,
  setHasUnsavedChanges,
  debouncedUpdateLocalConfig,
}: {
  formValues: PromptConfigFormValues;
  refs: EditorRefs;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;
  debouncedUpdateLocalConfig: DebouncedLocalConfig;
}): void {
  const isUnsaved = isUnsavedFormValues({
    formValues,
    isNewPrompt: !refs.promptId.current,
    saved: refs.savedFormValues.current,
  });
  setHasUnsavedChanges((prev) => (prev === isUnsaved ? prev : isUnsaved));

  // Before init the form holds defaults, which would overwrite the node's
  // real config; and only the target the form was initialised for is fed.
  const feedsCaller =
    refs.onLocalConfigChange.current &&
    refs.isFormInitialized.current &&
    refs.targetId.current === refs.initializedTargetId.current;
  if (!feedsCaller) return;
  if (isUnsaved) {
    debouncedUpdateLocalConfig(extractLocalConfig(formValues));
    return;
  }
  debouncedUpdateLocalConfig.cancel();
  refs.onLocalConfigChange.current?.(undefined);
}

/**
 * The editor's form over its whole life: seeded from the caller's unpublished
 * edits, initialised once the stored prompt (or the defaults) arrive, re-armed
 * on a new prompt, version or target, and watched for unsaved changes.
 */
export function usePromptEditorForm(input: EditorFormInput) {
  const { promptId, prompt, modelMetadata } = input;

  const savedFormValues = useMemo(
    () =>
      prompt.data
        ? versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt.data)
        : undefined,
    [prompt.data],
  );

  // Seeded from the caller's edits so the watch's first synchronous fire
  // carries them rather than defaults (#3155).
  const [configValues, setConfigValues] = useState<PromptConfigFormValues>(() =>
    localConfigToFormValues(input.initialLocalConfig ?? input.inlineConfigFallback),
  );
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const { methods } = usePromptConfigForm({ initialConfigValues: configValues });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const refs = useEditorRefs({ input, savedFormValues });
  const isNewOrNotFoundPrompt = !promptId || (!prompt.data && !prompt.isLoading);

  useEditorFormInit({
    input,
    methods,
    refs,
    isNewOrNotFoundPrompt,
    initialized: { value: isFormInitialized, set: setIsFormInitialized, setConfigValues },
  });
  useDefaultModelBackfill({
    methods,
    enabled: isFormInitialized && isNewOrNotFoundPrompt,
    resolvedDefaultModel: input.resolvedDefaultModel,
    modelMetadata,
  });
  useFormRearm({ input, refs, setIsFormInitialized });
  const debouncedUpdateLocalConfig = useMemo<DebouncedLocalConfig>(
    () =>
      debounce(
        (config: LocalPromptConfig | undefined) => refs.onLocalConfigChange.current?.(config),
        500,
        { leading: true },
      ),
    [refs],
  );

  // Watched without re-rendering, so typing keeps focus.
  useEffect(() => {
    const subscription = methods.watch((values) =>
      onFormValuesChanged({
        formValues: values as PromptConfigFormValues,
        refs,
        setHasUnsavedChanges,
        debouncedUpdateLocalConfig,
      }),
    );
    return () => {
      subscription.unsubscribe();
      debouncedUpdateLocalConfig.cancel();
    };
  }, [methods, debouncedUpdateLocalConfig, refs]);

  useEffect(() => {
    if (!savedFormValues) return;
    refs.savedFormValues.current = savedFormValues;
    setHasUnsavedChanges(!areFormValuesEqual(methods.getValues(), savedFormValues));
  }, [savedFormValues, methods, refs]);

  /** Makes `values` both the form and the saved reference, as after a save or restore. */
  const resetToSaved = useCallback(
    (values: PromptConfigFormValues) => {
      refs.savedFormValues.current = values;
      methods.reset(values);
    },
    [methods, refs],
  );

  return {
    methods,
    hasUnsavedChanges,
    debouncedUpdateLocalConfig,
    setConfigValues,
    resetToSaved,
  };
}

/**
 * Fills in the model once the resolved default arrives after init ran with
 * none (#5827), with its token ceiling unless the user already set one.
 */
function useDefaultModelBackfill({
  methods,
  enabled,
  resolvedDefaultModel,
  modelMetadata,
}: {
  methods: ReturnType<typeof usePromptConfigForm>["methods"];
  enabled: boolean;
  resolvedDefaultModel: string | undefined;
  modelMetadata: Record<string, ModelMetadataForFrontend> | undefined;
}) {
  useEffect(() => {
    if (!enabled || !resolvedDefaultModel) return;
    if (methods.getValues("version.configData.llm.model")) return;

    methods.setValue("version.configData.llm.model", resolvedDefaultModel, { shouldDirty: false });
    const maxTokensIsDirty = methods.getFieldState(
      "version.configData.llm.maxTokens",
      methods.formState,
    ).isDirty;
    const maxTokens = getMaxTokenLimit(modelMetadata?.[resolvedDefaultModel]);
    if (maxTokens && !maxTokensIsDirty) {
      methods.setValue("version.configData.llm.maxTokens", maxTokens, { shouldDirty: false });
    }
  }, [enabled, resolvedDefaultModel, modelMetadata, methods]);
}
