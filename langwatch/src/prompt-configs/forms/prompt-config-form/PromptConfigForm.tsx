import { FormProvider } from "react-hook-form";

import { DemonstrationsField } from "../fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "../fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "../fields/PromptNameField";
import { SaveVersionDialog } from "../SaveVersionDialog";

import { PromptConfigInfoBox } from "./components/PromptConfigInfoBox";
import {
  usePromptConfigFormController,
  type PromptConfigFormProps,
} from "./hooks/usePromptConfigFormController";

import { VerticalFormControl } from "~/components/VerticalFormControl";

/**
 * Form component for prompt configuration
 * Handles rendering the form fields and save dialog
 */
export function PromptConfigForm(props: PromptConfigFormProps) {
  const {
    isSaveVersionDialogOpen,
    setIsSaveVersionDialogOpen,
    handleSaveTrigger,
    handleSaveVersion,
    methods,
    savedConfig,
    isLoading,
  } = usePromptConfigFormController(props);

  const saveEnabled = methods.formState.isDirty;

  if (!savedConfig) return null;

  return (
    <>
      <FormProvider {...methods}>
        <form style={{ width: "100%" }}>
          <VerticalFormControl label="Current Version">
            <PromptConfigInfoBox
              isSaving={isLoading}
              config={savedConfig}
              saveEnabled={saveEnabled}
              onSaveClick={handleSaveTrigger}
            />
          </VerticalFormControl>
          <PromptNameField />
          <PromptConfigVersionFieldGroup />
          <DemonstrationsField />
        </form>
      </FormProvider>
      <SaveVersionDialog
        isOpen={isSaveVersionDialogOpen}
        onClose={() => setIsSaveVersionDialogOpen(false)}
        onSubmit={handleSaveVersion}
      />
    </>
  );
}
