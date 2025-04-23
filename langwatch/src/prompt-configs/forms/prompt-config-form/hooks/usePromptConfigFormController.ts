import { useDisclosure } from "@chakra-ui/react";
import { useCallback } from "react";

import { usePromptConfig } from "../../../hooks/usePromptConfig";
import { type usePromptConfigForm } from "../../../hooks/usePromptConfigForm";
import { type SaveDialogFormValues } from "../../SaveVersionDialog";

import { toaster } from "~/components/ui/toaster";

export type PromptConfigFormProps = ReturnType<typeof usePromptConfigForm> & {
  configId: string;
};

/**
 * Custom hook to handle the form controller logic, separating UI from business logic
 */
export const usePromptConfigFormController = ({
  methods,
  configId,
}: PromptConfigFormProps) => {
  const { open: isSaveVersionDialogOpen, setOpen: setIsSaveVersionDialogOpen } =
    useDisclosure();
  const {
    updatePromptNameIfChanged,
    createNewVersion,
    isLoading,
    promptConfig,
  } = usePromptConfig({
    configId,
  });

  /**
   * Open the save version dialog if the form is valid
   */
  const handleSaveTrigger = useCallback(() => {
    void (async () => {
      const isValid = await methods.trigger();
      if (!isValid) return;
      setIsSaveVersionDialogOpen(true);
    })();
  }, [methods, setIsSaveVersionDialogOpen]);

  /**
   * Save the version if the form is valid
   */
  const handleSaveVersion = useCallback(
    async (formValues: SaveDialogFormValues) => {
      const formData = methods.getValues();

      try {
        await updatePromptNameIfChanged(formData.name);

        await createNewVersion(
          formData.version.configData,
          formValues.commitMessage
        );

        setIsSaveVersionDialogOpen(false);
      } catch (error) {
        console.error(error);
        toaster.create({
          title: "Error",
          description: "Failed to save version",
          type: "error",
        });
      }
    },
    [
      methods,
      createNewVersion,
      setIsSaveVersionDialogOpen,
      updatePromptNameIfChanged,
    ]
  );

  return {
    methods,
    isSaveVersionDialogOpen,
    setIsSaveVersionDialogOpen,
    handleSaveTrigger,
    handleSaveVersion,
    isLoading,
    savedConfig: promptConfig,
  };
};
