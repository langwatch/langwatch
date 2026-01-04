import {
  type ComponentProps,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ChangeHandleDialog } from "../forms/ChangeHandleDialog";
import {
  type SaveDialogFormValues,
  SaveVersionDialog,
} from "../forms/SaveVersionDialog";
import type { ChangeHandleFormValues } from "../forms/schemas/change-handle-form.schema";
import { usePrompts } from "../hooks/usePrompts";
import type { PromptConfigContextType } from "./types";

/**
 * Creates a default context value that throws descriptive errors
 */
const createDefaultContextValue = (): PromptConfigContextType => ({
  triggerCreatePrompt: () => {
    throw new Error(
      "triggerCreatePrompt must be called within PromptConfigProvider",
    );
  },
  triggerSaveVersion: () => {
    throw new Error(
      "triggerSaveVersion must be called within PromptConfigProvider",
    );
  },
  triggerChangeHandle: () => {
    throw new Error(
      "triggerChangeHandle must be called within PromptConfigProvider",
    );
  },
});

const PromptConfigContext = createContext<PromptConfigContextType>(
  createDefaultContextValue(),
);

export const usePromptConfigContext = () => {
  const context = useContext(PromptConfigContext);
  if (!context) {
    throw new Error(
      "usePromptConfigContext must be used within a PromptConfigProvider",
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

  // Each state contains all props needed for the respective dialog
  const [saveVersionDialogProps, setSaveVersionDialogProps] =
    useState<ComponentProps<typeof SaveVersionDialog> | null>(null);

  const [createPromptDialogProps, setCreatePromptDialogProps] =
    useState<ComponentProps<typeof ChangeHandleDialog> | null>(null);

  const [changeHandleDialogProps, setChangeHandleDialogProps] =
    useState<ComponentProps<typeof ChangeHandleDialog> | null>(null);

  const { createPrompt, updatePrompt, updateHandle, getPromptById } =
    usePrompts();

  const triggerSaveVersion: PromptConfigContextType["triggerSaveVersion"] =
    useCallback(
      ({ id, data, nextVersion, onSuccess, onError }) => {
        const onSubmit = async (formValues: SaveDialogFormValues) => {
          try {
            const prompt = await updatePrompt({
              projectId,
              id,
              data: {
                ...data,
                commitMessage: formValues.commitMessage,
              },
            });
            onSuccess?.(prompt);
          } catch (error) {
            onError?.(error as Error);
          } finally {
            setSaveVersionDialogProps(null);
          }
        };

        setSaveVersionDialogProps({
          isOpen: true,
          onClose: () => setSaveVersionDialogProps(null),
          onSubmit,
          nextVersion,
        });
      },
      [updatePrompt, projectId],
    );

  const triggerCreatePrompt: PromptConfigContextType["triggerCreatePrompt"] =
    useCallback(
      ({ data, onSuccess, onError }) => {
        const onSubmit = async (formValues: ChangeHandleFormValues) => {
          try {
            const prompt = await createPrompt({
              projectId,
              data: {
                ...data,
                handle: formValues.handle,
                scope: formValues.scope,
                commitMessage: "Initial version",
              },
            });
            onSuccess?.(prompt);
          } catch (error) {
            onError?.(error as Error);
          } finally {
            setCreatePromptDialogProps(null);
          }
        };

        setCreatePromptDialogProps({
          isOpen: true,
          onClose: () => setCreatePromptDialogProps(null),
          onSubmit,
        });
      },
      [createPrompt, projectId],
    );

  const triggerChangeHandle: PromptConfigContextType["triggerChangeHandle"] =
    useCallback(
      ({ id, onSuccess, onError }) => {
        void (async () => {
          try {
            const prompt = await getPromptById({ id, projectId });

            if (!prompt) {
              throw new Error("Prompt not found");
            }

            const onSubmit = async (formValues: ChangeHandleFormValues) => {
              try {
                const updatedPrompt = await updateHandle({
                  projectId,
                  id,
                  data: formValues,
                });
                onSuccess?.(updatedPrompt);
              } catch (error) {
                onError?.(error as Error);
              } finally {
                setChangeHandleDialogProps(null);
              }
            };

            setChangeHandleDialogProps({
              isOpen: true,
              onClose: () => setChangeHandleDialogProps(null),
              currentHandle: prompt.handle,
              currentScope: prompt.scope,
              onSubmit,
            });
          } catch (error) {
            onError?.(error as Error);
          }
        })();
      },
      [updateHandle, getPromptById, projectId],
    );

  return (
    <PromptConfigContext.Provider
      value={{ triggerCreatePrompt, triggerSaveVersion, triggerChangeHandle }}
    >
      {children}

      {/*
      We cannot render the dialogs conditionally - doing so will break the state machine of chakra dialogs
      ie: index.mjs:321 [@zag-js/core > transition] Cannot transition a stopped machine
       */}
      <SaveVersionDialog
        isOpen={false}
        onClose={() => void 0}
        onSubmit={() => Promise.resolve()}
        {...saveVersionDialogProps}
      />

      <ChangeHandleDialog
        isOpen={false}
        onClose={() => void 0}
        onSubmit={() => Promise.resolve()}
        {...createPromptDialogProps}
      />

      <ChangeHandleDialog
        isOpen={false}
        onClose={() => void 0}
        onSubmit={() => Promise.resolve()}
        {...changeHandleDialogProps}
      />
    </PromptConfigContext.Provider>
  );
}
