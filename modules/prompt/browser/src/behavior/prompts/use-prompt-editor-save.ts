import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { promptClient } from "@langwatch/prompt-client";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import { useCallback, useRef, useState } from "react";

import { formValuesToTriggerSaveVersionParams } from "../../model/prompt-node-conversion.ts";
import type { WireVersionedPrompt } from "../../model/wire-versioned-prompt.ts";
import {
  type ChangeHandleFormValues,
  getSaveBlockerMessage,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../../prompt-form.ts";
import { promptApi } from "../prompt-api.ts";
import type { usePromptConfigForm } from "../use-prompt-config-form.ts";

type SavedPrompt = {
  id: string;
  handle?: string | null;
  version: number;
  versionId: string;
  inputs?: { identifier: string; type: string }[];
  outputs?: { identifier: string; type: string; json_schema?: object | null }[];
};

type VersionChange = {
  version: number;
  versionId: string;
  inputs?: { identifier: string; type: string }[];
  outputs?: { identifier: string; type: string }[];
};

type EditorSaveInput = {
  project: { id: string } | undefined;
  hasPermission: (permission: string) => boolean;
  promptId: string | undefined;
  storedPrompt: { id: string; handle?: string | null } | null | undefined;
  refetchPrompt: () => unknown;
  methods: ReturnType<typeof usePromptConfigForm>["methods"];
  onSave: ((prompt: Omit<SavedPrompt, "handle"> & { name: string }) => void) | undefined;
  onClose: () => void;
  onVersionChange: ((prompt: VersionChange) => void) | undefined;
  setConfigValues: (values: PromptConfigFormValues) => void;
  resetToSaved: (values: PromptConfigFormValues) => void;
};

const savedPromptPayload = (prompt: SavedPrompt) => ({
  id: prompt.id,
  name: prompt.handle ?? "New Prompt",
  version: prompt.version,
  versionId: prompt.versionId,
  inputs: prompt.inputs,
  outputs: prompt.outputs,
});

const versionChangeOf = (prompt: VersionChange): VersionChange => ({
  version: prompt.version,
  versionId: prompt.versionId,
  inputs: prompt.inputs,
  outputs: prompt.outputs,
});

/** The create, update and rename mutations, each with its own refresh and refusal. */
function useEditorMutations(input: EditorSaveInput) {
  const { project, promptId, onSave, onClose, setConfigValues, resetToSaved } = input;
  const utils = promptApi.useUtils();
  const projectId = project?.id ?? "";

  const createMutation = promptClient.prompts.create.useMutation({
    onSuccess: (prompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate({ projectId });
      onSave?.(savedPromptPayload(prompt));
      onClose();
    },
    // No form bridge: handle and scope come from the Save dialog, not this form.
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't create prompt" }),
  });

  const updateMutation = promptClient.prompts.update.useMutation({
    onSuccess: (prompt) => {
      const freshFormValues = versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);
      // configValues first, so the form hook's forward sync sees the form match
      // and does not restore stale initialLocalConfig.
      setConfigValues(freshFormValues);
      resetToSaved(freshFormValues);
      const reference = { idOrHandle: promptId ?? "", projectId };
      void utils.prompts.getAllPromptsForProject.invalidate({ projectId });
      void utils.prompts.getByIdOrHandle.invalidate(reference);
      void utils.prompts.getAllVersionsForPrompt.invalidate(reference);
      onSave?.(savedPromptPayload(prompt));
      // Stays open: the user keeps editing or closes it themselves.
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save prompt" }),
  });

  const updateHandleMutation = promptClient.prompts.updateHandle.useMutation({
    onSuccess: (prompt) => {
      void input.refetchPrompt();
      void utils.prompts.getAllPromptsForProject.invalidate({ projectId });
      toaster.create({
        title: "Prompt renamed",
        description: `Prompt handle changed to "${prompt.handle}"`,
        type: "success",
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't rename prompt" }),
  });

  return { createMutation, updateMutation, updateHandleMutation, utils };
}

type SaveMutations = Pick<
  ReturnType<typeof useEditorMutations>,
  "createMutation" | "updateMutation"
>;

/** A new version of a stored prompt, or the first version of a new one. */
function submitSave({
  projectId,
  saveData,
  commitMessage,
  storedId,
  newPrompt,
  mutations,
}: {
  projectId: string;
  saveData: ReturnType<typeof formValuesToTriggerSaveVersionParams>;
  commitMessage: string;
  storedId: string | undefined;
  newPrompt: { handle: string; scope: "PROJECT" | "ORGANIZATION" } | undefined;
  mutations: SaveMutations;
}): void {
  if (storedId) {
    mutations.updateMutation.mutate({
      projectId,
      id: storedId,
      data: { ...saveData, commitMessage },
    });
    return;
  }
  if (newPrompt) {
    mutations.createMutation.mutate({
      projectId,
      data: { ...saveData, ...newPrompt, commitMessage },
    });
  }
}

/** Validates and stages a save, then runs it when its dialog answers, past the permission gate. */
function useStagedSave({
  input,
  isStored,
  mutations,
}: {
  input: EditorSaveInput;
  isStored: boolean;
  mutations: SaveMutations;
}) {
  const { project, hasPermission, storedPrompt, methods } = input;
  const { createMutation, updateMutation } = mutations;
  const openLiteMemberRestriction = useUpgradeModalStore(
    (state) => state.openLiteMemberRestriction,
  );
  const pendingSaveDataRef = useRef<ReturnType<typeof formValuesToTriggerSaveVersionParams> | null>(
    null,
  );

  /** Validates the whole form (the #3196 system-prompt rule included) and stages the save. */
  const validateAndPrepare = useCallback(async () => {
    if (!project?.id) return false;
    if (!(await methods.trigger())) {
      toaster.create({
        title: "Validation error",
        description: getSaveBlockerMessage(methods),
        type: "error",
      });
      return false;
    }
    pendingSaveDataRef.current = formValuesToTriggerSaveVersionParams(methods.getValues());
    return true;
  }, [project?.id, methods]);

  const executeSave = useCallback(
    ({
      commitMessage,
      newPrompt,
    }: {
      commitMessage: string;
      newPrompt?: { handle: string; scope: "PROJECT" | "ORGANIZATION" };
    }) => {
      const saveData = pendingSaveDataRef.current;
      if (!project?.id || !saveData || (!isStored && !newPrompt)) return;
      const permission = isStored ? "prompts:update" : "prompts:create";
      if (!hasPermission(permission)) {
        openLiteMemberRestriction({ resource: "prompts" });
        return;
      }
      submitSave({
        projectId: project.id,
        saveData,
        commitMessage,
        storedId: isStored ? storedPrompt?.id : undefined,
        newPrompt,
        mutations: { createMutation, updateMutation },
      });
    },
    [
      project?.id,
      isStored,
      storedPrompt,
      createMutation,
      updateMutation,
      hasPermission,
      openLiteMemberRestriction,
    ],
  );

  return { validateAndPrepare, executeSave };
}

/** Restoring a version from history and upgrading a pinned one to the latest. */
function useVersionSwitching({
  input,
  utils,
}: {
  input: EditorSaveInput;
  utils: ReturnType<typeof useEditorMutations>["utils"];
}) {
  const { promptId, project, onVersionChange, resetToSaved } = input;
  /** Restores a version from history, telling the caller before the form resets. */
  const handleVersionRestore = async (prompt: WireVersionedPrompt) => {
    onVersionChange?.(versionChangeOf(prompt));
    resetToSaved(versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt));
  };

  /** Loads the actual latest version (not the pinned one) and tells the caller. */
  const handleUpgradeToLatest = useCallback(async () => {
    if (!promptId || !project?.id) return;
    try {
      const latestPrompt = await utils.prompts.getByIdOrHandle.fetch({
        idOrHandle: promptId,
        projectId: project.id,
      });
      if (!latestPrompt) return;
      resetToSaved(versionedPromptToPromptConfigFormValuesWithSystemMessage(latestPrompt));
      onVersionChange?.(versionChangeOf(latestPrompt));
    } catch (error) {
      console.error("Failed to upgrade to latest version:", error);
    }
  }, [promptId, project?.id, utils.prompts.getByIdOrHandle, resetToSaved, onVersionChange]);

  return { handleVersionRestore, handleUpgradeToLatest };
}

/**
 * Saving from the editor: validation, the commit-message and handle dialogs,
 * the permission gate, rename, version restore and upgrade to latest.
 */
export function usePromptEditorSave(input: EditorSaveInput) {
  const { project, promptId, storedPrompt } = input;
  const { createMutation, updateMutation, updateHandleMutation, utils } = useEditorMutations(input);
  const isStored = !!promptId && !!storedPrompt?.id;
  const { validateAndPrepare, executeSave } = useStagedSave({
    input,
    isStored,
    mutations: { createMutation, updateMutation },
  });
  const { handleVersionRestore, handleUpgradeToLatest } = useVersionSwitching({ input, utils });

  const [saveVersionDialogOpen, setSaveVersionDialogOpen] = useState(false);
  const [savePromptDialogOpen, setSavePromptDialogOpen] = useState(false);
  const [changeHandleDialogOpen, setChangeHandleDialogOpen] = useState(false);
  const handleSave = useCallback(async () => {
    if (!(await validateAndPrepare())) return;
    // A stored prompt asks for a commit message; a new one for its handle.
    if (isStored) setSaveVersionDialogOpen(true);
    else setSavePromptDialogOpen(true);
  }, [validateAndPrepare, isStored]);

  const handleChangeHandleSubmit = useCallback(
    async (formValues: ChangeHandleFormValues) => {
      if (!project?.id || !storedPrompt?.id) return;
      updateHandleMutation.mutate({ projectId: project.id, id: storedPrompt.id, data: formValues });
      setChangeHandleDialogOpen(false);
    },
    [project?.id, storedPrompt?.id, updateHandleMutation],
  );

  return {
    isSaving: createMutation.isPending || updateMutation.isPending,
    handleSave,
    saveVersionDialog: {
      open: saveVersionDialogOpen,
      onClose: () => setSaveVersionDialogOpen(false),
      onSubmit: async ({ commitMessage }: { commitMessage: string }) => {
        executeSave({ commitMessage });
        setSaveVersionDialogOpen(false);
      },
    },
    savePromptDialog: {
      open: savePromptDialogOpen,
      onClose: () => setSavePromptDialogOpen(false),
      onSubmit: async ({ handle, scope }: ChangeHandleFormValues) => {
        executeSave({ commitMessage: "Initial version", newPrompt: { handle, scope } });
        setSavePromptDialogOpen(false);
      },
    },
    changeHandleDialog: {
      open: changeHandleDialogOpen,
      openDialog: () => setChangeHandleDialogOpen(true),
      onClose: () => setChangeHandleDialogOpen(false),
      onSubmit: handleChangeHandleSubmit,
    },
    handleVersionRestore,
    handleUpgradeToLatest,
  };
}
