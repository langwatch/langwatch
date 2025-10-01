import type { PromptScope } from "@prisma/client";
import {
  createContext,
  useCallback,
  useContext,
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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigContextType, } from "./types";

/**
 * Creates a default context value that throws descriptive errors
 */
const createDefaultContextValue = (): PromptConfigContextType => ({
  triggerCreatePrompt: () => {
    throw new Error(
      "triggerCreatePrompt must be called within PromptConfigProvider"
    );
  },
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



/**
 * Provider for prompt configuration operations.
 * Single Responsibility: Manages dialog-based prompt operations with closures.
 */
export function PromptConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectId = "" } = useOrganizationTeamProject();
  const [activeDialog, setActiveDialog] = useState<React.ReactNode | null>(null);
  const { createPrompt, updatePrompt, getPromptById } = usePrompts();

  const triggerCreatePrompt: PromptConfigContextType["triggerCreatePrompt"] =
    useCallback(
      async ({ data }) => {
        return new Promise<VersionedPrompt>((resolve, reject) => {
          const createPromptClosure = async (formValues: ChangeHandleFormValues) => {
            try {
              const prompt = await createPrompt({
                projectId,
                data: {
                  ...data,
                  handle: formValues.handle,
                  scope: formValues.scope,
                  commitMessage: "Initial version",
                }
              });
              resolve(prompt);
            } catch (error) {
              reject(error);
            } finally {
              setActiveDialog(null);
            }
          };

          setActiveDialog(
            <ChangeHandleDialog
              isOpen={true}
              onClose={() => setActiveDialog(null)}
              onSubmit={createPromptClosure}
            />
          );
        });
      },
      [createPrompt, projectId]
    );

  const triggerSaveVersion: PromptConfigContextType["triggerSaveVersion"] =
    useCallback(
      async ({ id, data }) => {
        return new Promise<VersionedPrompt>((resolve, reject) => {
          const saveVersionClosure = async (formValues: SaveDialogFormValues) => {
            try {
              const prompt = await updatePrompt({
                projectId,
                id,
                data: {
                  ...data,
                  commitMessage: formValues.commitMessage,
                }
              });
              resolve(prompt);
            } catch (error) {
              reject(error);
            } finally {
              setActiveDialog(null);
            }
          };

          setActiveDialog(
            <SaveVersionDialog
              isOpen={true}
              onClose={() => setActiveDialog(null)}
              onSubmit={saveVersionClosure}
            />
          );
        });
      },
      [updatePrompt, projectId]
    );

  const triggerChangeHandle: PromptConfigContextType["triggerChangeHandle"] =
    useCallback(
      async ({ id }) => {
        const prompt = await getPromptById({ id, projectId });

        if (!prompt) {
          throw new Error("Prompt not found");
        }
        
        return new Promise<VersionedPrompt>((resolve, reject) => {
          const handleChangeClosure = async (formValues: ChangeHandleFormValues) => {
            try {
              const updatedPrompt = await updatePrompt({
                projectId,
                id,
                data: {
                  ...formValues,
                  commitMessage: `Changed handle to "${formValues.handle}"`,
                },
              });
              resolve(updatedPrompt);
            } catch (error) {
              reject(error);
            } finally {
              setActiveDialog(null);
            }
          };

          setActiveDialog(
            <ChangeHandleDialog
              currentHandle={prompt.handle}
              currentScope={prompt.scope}
              isOpen={true}
              onClose={() => setActiveDialog(null)}
              onSubmit={handleChangeClosure}
            />
          );
        });
      },
      [updatePrompt, getPromptById, projectId]
    );

  return (
    <PromptConfigContext.Provider
      value={{ triggerCreatePrompt, triggerSaveVersion, triggerChangeHandle }}
    >
      {children}
      {activeDialog}
    </PromptConfigContext.Provider>
  );
}
