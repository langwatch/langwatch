import type { PromptScope } from "@prisma/client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import type { VersionedPrompt } from "~/server/prompt-config";

import { ChangeHandleDialog } from "../forms/ChangeHandleDialog";
import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import type { ChangeHandleFormValues } from "../forms/schemas/change-handle-form.schema";
import { usePrompts } from "../hooks/usePrompts";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  CreatePromptParams,
  PromptConfigContextType,
  UpdatePromptParams,
} from "./types";

/**
 * Creates a default context value that throws descriptive errors
 */
const createDefaultContextValue = (): PromptConfigContextType => ({
  triggerSaveVersion: () => {
    throw new Error(
      "triggerSaveVersion must be called within PromptConfigProvider"
    );
  },
  triggerChangeHandle: () => {
    throw new Error(
      "triggerChangeHandle must be called within PromptConfigProvider"
    );
  },
});

const PromptConfigContext = createContext<PromptConfigContextType>(
  createDefaultContextValue()
);

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
  // The user will need to change the handle if they are creating a new prompt
  // because the handle is required and must be unique
  // or if they are updating the handle of an existing prompt
  needsHandleChange?: boolean;
}

enum DialogType {
  SAVE,
  CHANGE_HANDLE,
}

interface ClosureParams {
  handle: string;
  scope: PromptScope;
  commitMessage: string;
}

interface SaveClosureParams {
  closure: (params: ClosureParams) => Promise<void>;
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
  const { projectId = "" } = useOrganizationTeamProject();
  const closureRef = useRef<((params: ClosureParams) => Promise<VersionedPrompt>) | null>(
    null
  );
  const { createPrompt, updatePrompt } = usePrompts();
  const [dialogType, setDialogType] = useState<DialogType | null>(null);

  const closeDialog = useCallback(() => {
    closureRef.current = null;
  }, []);

  const triggerSaveVersion: PromptConfigContextType["triggerSaveVersion"] =
    useCallback(
      async ({ data, onError, onSuccess }) => {
        const promise = new Promise<VersionedPrompt>((resolve, reject) => {
        
          closureRef.current = async ({ handle, scope }) => {
            try {
              const prompt = await createPrompt({
                projectId,
                data: {
                  ...data,
                  handle,
                  scope,
                  commitMessage: "Initial version",
                }
              });
              onSuccess?.(prompt);
              resolve(prompt);
              return prompt; // Add this line
            } catch (error) {
                onError?.(error as Error);
                reject(error);
                throw error; // Add this to maintain error propagation
            } finally {
                closeDialog();
            }
          };
        });

        setDialogType(DialogType.SAVE);

        return promise;
      },
      [createPrompt, projectId, closeDialog]
    );

  return (
    <PromptConfigContext.Provider
      value={{ triggerSaveVersion, triggerChangeHandle }}
    >
      {children}
      <ChangeHandleDialog
        currentHandle={saveDialogData?.handle}
        currentScope={saveDialogData?.scope}
        isOpen={Boolean(isChangeHandleDialogOpen)}
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
      <SaveVersionDialog
        isOpen={isSaveDialogOpen}
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
    </PromptConfigContext.Provider>
  );
}
