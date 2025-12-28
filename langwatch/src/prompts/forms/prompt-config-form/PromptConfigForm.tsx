import { HStack, Spacer, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import {
  FormProvider,
  type UseFormReturn,
  useFieldArray,
  useFormContext,
} from "react-hook-form";
import { toaster } from "~/components/ui/toaster";
import type { PromptConfigFormValues } from "~/prompts";
import { usePromptConfigContext } from "~/prompts/providers/PromptConfigProvider";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValues,
} from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config";
import { PromptConfigProvider } from "../../providers/PromptConfigProvider";
import { DemonstrationsField } from "../fields/DemonstrationsField";
import { ModelSelectField } from "../fields/ModelSelectField";
import { PromptMessagesField } from "../fields/message-history-fields/PromptMessagesField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "../fields/PromptConfigVersionFieldGroup";
import { PromptHandleInfo } from "./components/PromptHandleInfo";
import { VersionHistoryButton } from "./components/VersionHistoryButton";
import { VersionSaveButton } from "./components/VersionSaveButton";

interface PromptConfigFormProps {
  methods: UseFormReturn<PromptConfigFormValues>;
}

/**
 * Form component for prompt configuration
 * Handles rendering the form fields and save dialog
 */
function InnerPromptConfigForm() {
  const { triggerSaveVersion, triggerCreatePrompt } = usePromptConfigContext();
  const methods = useFormContext<PromptConfigFormValues>();
  const [isSaving, setIsSaving] = useState(false);
  const configId = methods.watch("configId");
  const isDraft = !Boolean(methods.watch("handle"));
  const saveEnabled = (methods.formState.isDirty || isDraft) && !isSaving;

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

  const handleSaveClick = useCallback(async () => {
    const isValid = await methods.trigger("version.configData.llm");
    if (!isValid) {
      toaster.create({
        title: "Validation error",
        description: "Please fix the LLM configuration errors before saving",
        type: "error",
      });
      return;
    }

    setIsSaving(true);

    const values = methods.getValues();
    const data = formValuesToTriggerSaveVersionParams(values);

    const onSuccess = (prompt: VersionedPrompt) => {
      methods.reset(versionedPromptToPromptConfigFormValues(prompt));
      setIsSaving(false);
    };

    const onError = (error: Error) => {
      console.error(error);
      toaster.create({
        title: "Error saving version",
        description: "Failed to save version",
        type: "error",
      });
      setIsSaving(false);
    };

    if (configId) {
      triggerSaveVersion({ id: configId, data, onSuccess, onError });
    } else {
      triggerCreatePrompt({ data, onSuccess, onError });
    }
  }, [methods, triggerSaveVersion, triggerCreatePrompt, configId]);

  /**
   * We want discourage the user from using demonstrations
   * but need to display the field if there are demonstrations already
   * in the prompt configuration (via the studio).
   */
  const demonstrations = methods.watch("version.configData.demonstrations");
  const demonstrationRecordsLength =
    Object.values(demonstrations?.inline?.records ?? { dummy: [] })[0]
      ?.length ?? 0;
  const hasDemonstrations = demonstrationRecordsLength > 0;

  const handleRestore = useCallback(
    async (prompt: VersionedPrompt) => {
      methods.reset(versionedPromptToPromptConfigFormValues(prompt));
    },
    [methods],
  );

  return (
    <form style={{ width: "100%", height: "100%" }}>
      <VStack width="full" height="full" gap={6} mb={6}>
        <VStack width="full" gap={6} mb={6} paddingBottom="70px">
          <PromptHandleInfo />
          <ModelSelectField />
          <PromptMessagesField
            messageFields={messageFields}
            availableFields={availableFields}
            otherNodesFields={{}}
          />
          <InputsFieldGroup />
          <OutputsFieldGroup />
          {hasDemonstrations && <DemonstrationsField />}
        </VStack>
        <HStack
          gap={2}
          width="full"
          position="absolute"
          bottom={0}
          background="white"
          padding={3}
          boxShadow="0 0px 6px rgba(0, 0, 0, 0.1)"
        >
          {configId && (
            <VersionHistoryButton
              configId={configId}
              label="History"
              onRestoreSuccess={handleRestore}
            />
          )}
          <Spacer />
          <VersionSaveButton
            disabled={!saveEnabled}
            onClick={() => void handleSaveClick()}
          />
        </HStack>
      </VStack>
    </form>
  );
}

export function PromptConfigForm(props: PromptConfigFormProps) {
  return (
    <FormProvider {...props.methods}>
      <PromptConfigProvider>
        <InnerPromptConfigForm />
      </PromptConfigProvider>
    </FormProvider>
  );
}
