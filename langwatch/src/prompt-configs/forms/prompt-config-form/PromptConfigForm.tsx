import { FormProvider, type UseFormReturn } from "react-hook-form";

import { PromptConfigProvider } from "../../providers/PromptConfigProvider";
import { DemonstrationsField } from "../fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "../fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "../fields/PromptNameField";

import { PromptConfigInfoBox } from "./components/PromptConfigInfoBox";

import { VerticalFormControl } from "~/components/VerticalFormControl";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import type { PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";

interface PromptConfigFormProps {
  configId: string;
  methods: UseFormReturn<PromptConfigFormValues>;
}

/**
 * Form component for prompt configuration
 * Handles rendering the form fields and save dialog
 */
function InnerPromptConfigForm(props: PromptConfigFormProps) {
  const { methods, configId } = props;
  const { isLoading, promptConfig: savedConfig } = usePromptConfig({
    configId,
  });
  const { triggerSaveVersion } = usePromptConfigContext();

  const saveEnabled = methods.formState.isDirty;

  if (!savedConfig) return null;

  return (
    <FormProvider {...methods}>
      <form style={{ width: "100%" }}>
        <VerticalFormControl label="Current Version">
          <PromptConfigInfoBox
            isSaving={isLoading}
            config={savedConfig}
            saveEnabled={saveEnabled}
            onSaveClick={() => triggerSaveVersion(methods.getValues())}
          />
        </VerticalFormControl>
        <PromptNameField />
        <PromptConfigVersionFieldGroup />
        <DemonstrationsField />
      </form>
    </FormProvider>
  );
}

export function PromptConfigForm(props: PromptConfigFormProps) {
  return (
    <PromptConfigProvider configId={props.configId}>
      <InnerPromptConfigForm {...props} />
    </PromptConfigProvider>
  );
}
