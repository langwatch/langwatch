import type { PromptScope } from "@prisma/client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { type UseFormReturn } from "react-hook-form";

import type { LlmConfigWithLatestVersion } from "../../server/prompt-config/repositories";
import { ChangeHandleDialog } from "../forms/ChangeHandleDialog";
import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import type { ChangeHandleFormValues } from "../forms/schemas/change-handle-form.schema";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";
import { usePrompts } from "../hooks/usePrompts";

import { toaster } from "~/components/ui/toaster";
import { promptConfigFormValuesVersionToLlmConfigVersionConfigData } from "~/prompt-configs/llmPromptConfigUtils";

interface PromptConfigContextType {
  triggerSaveVersion: ({
    config,
    form,
    updateConfigValues,
    editingHandleOrScope,
  }: {
    config: LlmConfigWithLatestVersion;
    form: UseFormReturn<PromptConfigFormValues>;
    updateConfigValues: PromptConfigFormValues;
    editingHandleOrScope: boolean;
  }) => Promise<void>;
}

const PromptConfigContext = createContext<PromptConfigContextType>({
  triggerSaveVersion: () => {
    throw new Error("No triggerSaveVersion function provided");
  },
});

export const usePromptConfigContext = () => {
  const context = useContext(PromptConfigContext);
  if (!context) {
    throw new Error(
      "usePromptConfigContext must be used within a PromptConfigProvider"
    );
  }
  return context;
};

interface SaveDialogData {
  handle?: string | null;
  scope?: PromptScope;
}

/**
 * Provider for prompt configuration operations.
 * Single Responsibility: Manages the save flow for prompt configurations.
 */
export function PromptConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [saveDialogData, setSaveDialogData] = useState<SaveDialogData | null>(
    null
  );
  const saveClosureRef = useRef<
    | ((params: {
        handle: string; // Enforce that handle is always provide
        scope?: PromptScope;
        commitMessage: string;
      }) => Promise<void>)
    | null
  >(null);
  const { upsertPrompt } = usePrompts();

  const closeDialog = useCallback(() => {
    setSaveDialogData(null);
  }, []);

  const triggerSaveVersion = useCallback(
    async ({
      config,
      form,
      updateConfigValues,
    }: {
      config?: LlmConfigWithLatestVersion;
      form: UseFormReturn<PromptConfigFormValues>;
      updateConfigValues: PromptConfigFormValues;
      editingHandleOrScope: boolean;
    }) => {
      if (!config) return;
      setSaveDialogData({ handle: config.handle, scope: config.scope });

      const isValid = await form.trigger();
      if (!isValid) return;

      // Create the closure with all the save parameters
      saveClosureRef.current = async ({ handle, scope, commitMessage }) => {
        try {
          const prompt = await upsertPrompt({
            handle,
            scope: config.scope ?? scope,
            commitMessage,
            versionData:
              promptConfigFormValuesVersionToLlmConfigVersionConfigData(
                updateConfigValues.version
              ),
            projectId: config.projectId,
          });

          if (prompt.version === 1) {
            toaster.create({
              title: "Prompt created",
              description:
                "Prompt configuration has been created successfully.",
              type: "success",
            });
          } else {
            toaster.create({
              title: "Prompt saved",
              description: "Prompt configuration has been saved successfully.",
              type: "success",
            });
          }

          closeDialog();
        } catch (error) {
          toaster.create({
            title: "Failed to save",
            description:
              error instanceof Error ? error.message : "Please try again.",
            type: "error",
          });
        }
      };
    },
    [closeDialog, upsertPrompt]
  );

  const isChangeHandleDialogOpen = !!saveDialogData && !saveDialogData.handle;
  const isSaveDialogOpen = !!saveDialogData && !!saveDialogData.handle;

  return (
    <PromptConfigContext.Provider value={{ triggerSaveVersion }}>
      {children}
      {isChangeHandleDialogOpen && (
        <ChangeHandleDialog
          currentHandle={saveDialogData?.handle}
          currentScope={saveDialogData?.scope}
          isOpen={true}
          onClose={closeDialog}
          onSubmit={async (formValues: ChangeHandleFormValues) => {
            if (!saveClosureRef.current) return;
            await saveClosureRef.current({
              handle: formValues.handle,
              scope: formValues.scope,
              commitMessage: "Initial version",
            });
          }}
        />
      )}
      {isSaveDialogOpen && (
        <SaveVersionDialog
          isOpen={true}
          onClose={closeDialog}
          onSubmit={async (formValues: SaveDialogFormValues) => {
            if (!saveClosureRef.current) return;
            if (!saveDialogData?.handle) throw new Error("Handle is required"); // should never happen
            await saveClosureRef.current({
              handle: saveDialogData?.handle,
              commitMessage: formValues.commitMessage,
            });
          }}
        />
      )}
    </PromptConfigContext.Provider>
  );
}
