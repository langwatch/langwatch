import { HStack, VStack } from "@chakra-ui/react";
import {
  FormProvider,
  useFieldArray,
  type UseFormReturn,
} from "react-hook-form";

import { PromptConfigProvider } from "../../providers/PromptConfigProvider";
import { DemonstrationsField } from "../fields/DemonstrationsField";
import { ModelSelectField } from "../fields/ModelSelectField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "../fields/PromptConfigVersionFieldGroup";
import { PromptField } from "../fields/PromptField";
import { PromptMessagesField } from "../fields/PromptMessagesField";
import { PromptNameField } from "../fields/PromptNameField";
import { ReferenceIdField } from "../fields/ReferenceIdField";

import { PromptConfigInfoAndSavePartial } from "./components/PromptConfigInfoAndSavePartial";

import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { GeneratePromptApiSnippetDialog } from "~/prompt-configs/components/GeneratePromptApiSnippetDialog";
import { useGetPromptConfigByIdWithLatestVersionQuery } from "~/prompt-configs/hooks/useGetPromptConfigByIdWithLatestVersionQuery";
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
  const { project } = useOrganizationTeamProject();
  const { methods, configId } = props;
  const { isLoading } = usePromptConfig();
  const { triggerSaveVersion } = usePromptConfigContext();
  const saveEnabled = methods.formState.isDirty;
  const { data: savedConfig } =
    useGetPromptConfigByIdWithLatestVersionQuery(configId);

  /**
   * It is a known limitation of react-hook-form useFieldArray that we cannot
   * access the fields array from the form provider using the context.
   *
   * So we need to create this in the parent and prop drill it down.
   */
  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });

  const availableFields = (
    methods.watch("version.configData.inputs") ?? []
  ).map((input) => input.identifier);

  if (!savedConfig) return null;

  return (
    <form style={{ width: "100%" }}>
      <VStack width="full" gap={6}>
        <VerticalFormControl label="Current Version" size="sm">
          <PromptConfigInfoAndSavePartial
            isSaving={isLoading}
            config={savedConfig}
            saveEnabled={saveEnabled}
            onSaveClick={() =>
              triggerSaveVersion(configId, methods.getValues())
            }
          />
        </VerticalFormControl>
        <HStack width="full" alignItems="end">
          <PromptNameField />
          <GeneratePromptApiSnippetDialog
            configId={configId}
            apiKey={project?.apiKey}
          >
            <GeneratePromptApiSnippetDialog.Trigger>
              <GenerateApiSnippetButton />
            </GeneratePromptApiSnippetDialog.Trigger>
          </GeneratePromptApiSnippetDialog>
        </HStack>
        <ReferenceIdField />
        <ModelSelectField />
        <PromptField
          templateAdapter="default"
          messageFields={messageFields}
          availableFields={availableFields}
          otherNodesFields={{}}
          isTemplateSupported={true}
        />
        <PromptMessagesField
          messageFields={messageFields}
          availableFields={availableFields}
          otherNodesFields={{}}
        />
        <InputsFieldGroup />
        <OutputsFieldGroup />
        <DemonstrationsField />
      </VStack>
    </form>
  );
}

export function PromptConfigForm(props: PromptConfigFormProps) {
  return (
    <FormProvider {...props.methods}>
      <PromptConfigProvider>
        <InnerPromptConfigForm {...props} />
      </PromptConfigProvider>
    </FormProvider>
  );
}
