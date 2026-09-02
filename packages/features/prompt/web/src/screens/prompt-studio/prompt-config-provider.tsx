import { type ComponentProps, useCallback, useState } from "react";
import { usePromptProject } from "../../behavior/use-prompt-project";
import { isLimitExceeded, isLiteMemberRestriction } from "../../model/trpc-error-signals";
import { ChangeHandleDialog } from "./dialogs/change-handle-dialog";
import { type SaveDialogFormValues, SaveVersionDialog } from "./dialogs/save-version-dialog";
import type { ChangeHandleFormValues } from "../../surfaces/prompt-form";
import { usePrompts } from "../../behavior/use-prompts";
import type { PromptConfigContextType } from "../../model/prompt-config-operations";
import { PromptConfigContext } from "../../model/prompt-config-context";

/**
 * Provider for prompt configuration operations.
 * Single Responsibility: Manages dialog-based prompt operations with closures.
 */
export function PromptConfigProvider({ children }: { children: React.ReactNode }) {
  const { projectId = "" } = usePromptProject();

  // Each state contains all props needed for the respective dialog
  const [saveVersionDialogProps, setSaveVersionDialogProps] = useState<ComponentProps<
    typeof SaveVersionDialog
  > | null>(null);

  const [createPromptDialogProps, setCreatePromptDialogProps] = useState<ComponentProps<
    typeof ChangeHandleDialog
  > | null>(null);

  const [changeHandleDialogProps, setChangeHandleDialogProps] = useState<ComponentProps<
    typeof ChangeHandleDialog
  > | null>(null);

  const { createPrompt, updatePrompt, updateHandle, getPromptById } = usePrompts();

  const triggerSaveVersion: PromptConfigContextType["triggerSaveVersion"] = useCallback(
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
          setSaveVersionDialogProps(null);
        } catch (error) {
          onError?.(error as Error);
          // Don't close the dialog if a global handler will show a modal
          if (!isLimitExceeded(error) && !isLiteMemberRestriction(error)) {
            setSaveVersionDialogProps(null);
          }
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

  const triggerCreatePrompt: PromptConfigContextType["triggerCreatePrompt"] = useCallback(
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
          setCreatePromptDialogProps(null);
        } catch (error) {
          onError?.(error as Error);
          // Don't close the dialog if a global handler will show a modal
          if (!isLimitExceeded(error) && !isLiteMemberRestriction(error)) {
            setCreatePromptDialogProps(null);
          }
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

  const triggerChangeHandle: PromptConfigContextType["triggerChangeHandle"] = useCallback(
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
              setChangeHandleDialogProps(null);
            } catch (error) {
              onError?.(error as Error);
              // Don't close the dialog if a global handler will show a modal
              if (!isLimitExceeded(error) && !isLiteMemberRestriction(error)) {
                setChangeHandleDialogProps(null);
              }
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
