import { useDisclosure } from "@chakra-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useFormContext } from "react-hook-form";

import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import { usePromptConfig } from "../hooks/usePromptConfig";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";

import { toaster } from "~/components/ui/toaster";
import { promptConfigFormValuesVersionToLlmConfigVersionConfigData } from "~/prompt-configs/llmPromptConfigUtils";
import type { LlmConfigWithLatestVersion } from "../../server/prompt-config/repositories";
import {
  ChangeHandleDialog,
  type ChangeHandleDialogFormValues,
} from "../forms/ChangeHandleDialog";

interface PromptConfigContextType {
  triggerSaveVersion: ({
    config,
    updateConfigValues,
    editingHandleOrScope,
  }: {
    config: LlmConfigWithLatestVersion;
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

export function PromptConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dialog state
  const {
    open: isOpen,
    onOpen: openDialog,
    onClose: closeDialog,
  } = useDisclosure();
  const [currentConfig, setCurrentConfig] =
    useState<LlmConfigWithLatestVersion | null>(null);
  const [editingHandleOrScope, setEditingHandleOrScope] = useState(false);

  // Prompt config state
  const { updatePromptConfig, createNewVersion } = usePromptConfig();

  // Closure to save the function that will do the saving
  const updateConfigClosureRef = useRef<
    ((saveFormValues: SaveDialogFormValues) => Promise<void>) | null
  >(null);

  const methods = useFormContext<PromptConfigFormValues>();

  const triggerSaveVersion = useCallback(
    async ({
      config,
      updateConfigValues,
      editingHandleOrScope,
    }: {
      config: LlmConfigWithLatestVersion;
      updateConfigValues: PromptConfigFormValues;
      editingHandleOrScope: boolean;
    }) => {
      setCurrentConfig(config);
      setEditingHandleOrScope(editingHandleOrScope);
      // Trigger the form validation
      const isValid = await methods.trigger();

      if (!isValid) {
        // If the form is not valid, don't save
        return;
      }

      // Save a ref to the function that will do the saving
      // with the saveFormValues enclosed in the closure
      updateConfigClosureRef.current = async (
        saveFormValues: SaveDialogFormValues | ChangeHandleDialogFormValues
      ) => {
        try {
          if ("handle" in saveFormValues) {
            await updatePromptConfig(config.id, {
              handle: saveFormValues.handle,
              scope: saveFormValues.scope,
            });
          }

          if (saveFormValues.saveNewVersion) {
            const version = await createNewVersion(
              config.id,
              promptConfigFormValuesVersionToLlmConfigVersionConfigData(
                updateConfigValues.version
              ),
              saveFormValues.commitMessage
            );
            toaster.success({
              title: "Version saved",
              description: `Version ${version.version} has been saved successfully.`,
            });
          } else {
            if (
              "handle" in saveFormValues &&
              config.handle !== saveFormValues.handle
            ) {
              toaster.success({
                title: "Prompt config updated",
                description: `Prompt identifier has been updated successfully.`,
              });
            } else {
              toaster.success({
                title: "Prompt config updated",
                description: `Prompt scope has been updated successfully.`,
              });
            }
          }

          closeDialog();
        } catch (error) {
          console.error(error);
          toaster.error({
            title: "Failed to save version",
            description:
              error instanceof Error ? error.message : "Please try again.",
          });
        }
      };

      openDialog();
    },
    [openDialog, updatePromptConfig, createNewVersion, closeDialog, methods]
  );

  const firstTimeSave = !!(
    currentConfig &&
    (!currentConfig.handle || currentConfig.handle === currentConfig.id)
  );

  return (
    <PromptConfigContext.Provider value={{ triggerSaveVersion }}>
      {children}
      {currentConfig && (firstTimeSave || editingHandleOrScope) ? (
        <ChangeHandleDialog
          config={currentConfig}
          isOpen={isOpen}
          onClose={closeDialog}
          onSubmit={async (changeHandleFormValues) => {
            if (!updateConfigClosureRef.current)
              throw new Error("No closure found");
            await updateConfigClosureRef.current(changeHandleFormValues);
          }}
          firstTimeSave={firstTimeSave}
        />
      ) : (
        <SaveVersionDialog
          isOpen={isOpen}
          onClose={closeDialog}
          onSubmit={async (saveFormValues) => {
            if (!updateConfigClosureRef.current)
              throw new Error("No closure found");
            await updateConfigClosureRef.current(saveFormValues);
          }}
        />
      )}
    </PromptConfigContext.Provider>
  );
}
