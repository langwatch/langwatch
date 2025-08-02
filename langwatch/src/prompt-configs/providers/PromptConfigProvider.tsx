import { useDisclosure } from "@chakra-ui/react";
import { createContext, useCallback, useContext, useRef } from "react";
import { useFormContext } from "react-hook-form";

import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import { usePromptConfig } from "../hooks/usePromptConfig";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";

import { toaster } from "~/components/ui/toaster";
import { promptConfigFormValuesVersionToLlmConfigVersionConfigData } from "~/prompt-configs/llmPromptConfigUtils";

interface PromptConfigContextType {
  triggerSaveVersion: (
    configId: string,
    updateConfigValues: PromptConfigFormValues
  ) => Promise<void>;
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

  // Prompt config state
  const { updatePromptConfig, createNewVersion } = usePromptConfig();

  // Closure to save the function that will do the saving
  const updateConfigClosureRef = useRef<
    ((saveFormValues: SaveDialogFormValues) => Promise<void>) | null
  >(null);

  const methods = useFormContext<PromptConfigFormValues>();

  const triggerSaveVersion = useCallback(
    async (configId: string, updateConfigValues: PromptConfigFormValues) => {
      const isValid = await methods.trigger();

      if (!isValid) {
        return;
      }

      // Save a ref to the function that will do the saving
      // with the saveFormValues enclosed in the closure
      updateConfigClosureRef.current = async (
        saveFormValues: SaveDialogFormValues
      ) => {
        try {
          await updatePromptConfig(configId, updateConfigValues);
          const version = await createNewVersion(
            configId,
            promptConfigFormValuesVersionToLlmConfigVersionConfigData(
              updateConfigValues.version
            ),
            saveFormValues.commitMessage
          );

          closeDialog();

          toaster.success({
            title: "Version saved",
            description: `Version ${version.version} has been saved successfully.`,
          });
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
    [openDialog, updatePromptConfig, createNewVersion, closeDialog]
  );

  return (
    <PromptConfigContext.Provider value={{ triggerSaveVersion }}>
      {children}
      <SaveVersionDialog
        isOpen={isOpen}
        onClose={closeDialog}
        onSubmit={async (saveFormValues) => {
          if (!updateConfigClosureRef.current)
            throw new Error("No closure found");
          await updateConfigClosureRef.current(saveFormValues);
        }}
      />
    </PromptConfigContext.Provider>
  );
}
