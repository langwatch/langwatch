import { useDisclosure } from "@chakra-ui/react";
import { createContext, useCallback, useContext, useRef } from "react";

import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "../forms/SaveVersionDialog";
import { usePromptConfig } from "../hooks/usePromptConfig";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";

interface PromptConfigContextType {
  triggerSaveVersion: (updateConfigValues: PromptConfigFormValues) => void;
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
  configId,
  children,
}: {
  configId: string;
  children: React.ReactNode;
}) {
  // Dialog state
  const {
    open: isOpen,
    onOpen: openDialog,
    onClose: closeDialog,
  } = useDisclosure();

  // Prompt config state
  const { updatePromptNameIfChanged, createNewVersion } = usePromptConfig({
    configId,
  });

  // Closure to save the function that will do the saving
  const updateConfigClosureRef = useRef<
    ((saveFormValues: SaveDialogFormValues) => Promise<void>) | null
  >(null);

  const triggerSaveVersion = useCallback(
    (updateConfigValues: PromptConfigFormValues) => {
      // Save a ref to the function that will do the saving
      // with the saveFormValues enclosed in the closure
      updateConfigClosureRef.current = async (
        saveFormValues: SaveDialogFormValues
      ) => {
        await updatePromptNameIfChanged(updateConfigValues.name);

        await createNewVersion(
          updateConfigValues.version.configData,
          saveFormValues.commitMessage
        );

        closeDialog();
      };

      openDialog();
    },
    [openDialog, updatePromptNameIfChanged, createNewVersion, closeDialog]
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
