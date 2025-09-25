import { HStack, Spacer, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
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

import { PromptHandleInfo } from "./components/PromptHandleInfo";
import { VersionHistoryButton } from "./components/VersionHistoryButton";
import { VersionSaveButton } from "./components/VersionSaveButton";

import { toaster } from "~/components/ui/toaster";
import { useGetPromptConfigByIdWithLatestVersionQuery } from "~/prompt-configs/hooks/useGetPromptConfigByIdWithLatestVersionQuery";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { llmConfigToPromptConfigFormValues } from "~/prompt-configs/llmPromptConfigUtils";
import { usePromptConfigContext } from "~/prompt-configs/providers/PromptConfigProvider";
import { createLogger } from "~/utils/logger";

const logger = createLogger("PromptConfigForm");

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
  const { isLoading } = usePromptConfig();
  const { triggerSaveVersion } = usePromptConfigContext();
  const saveEnabled = methods.formState.isDirty;
  const { refetch: refetchSavedConfig } =
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

  const handleSaveClick = useCallback(() => {
    const values = methods.getValues();
    triggerSaveVersion({
      data: {
        handle: values.handle,
        scope: values.scope,
        prompt: values.version.configData.prompt,
        messages: values.version.configData.messages,
        inputs: values.version.configData.inputs,
        outputs: values.version.configData.outputs,
        model: values.version.configData.llm.model,
        temperature: values.version.configData.llm.temperature,
        maxTokens: values.version.configData.llm.max_tokens,
        promptingTechnique: values.version.configData.prompting_technique,
        demonstrations: values.version.configData.demonstrations,
      },
    })
  }, [methods, triggerSaveVersion]);

  const demonstrations = methods.watch("version.configData.demonstrations");
  const hasDemonstrations = Boolean(
    Object.values(
      demonstrations?.inline?.records ?? {
        dummy: [],
      }
    )[0]?.length ?? 0 > 0
  );

  // TODO: I think this doesn't need to be called here.
  const handleRestore = useCallback(
    (_versionId: string) => {
      refetchSavedConfig()
        .then(({ data: restoredConfig }) => {
          if (!restoredConfig) throw new Error("Restored config is missing");
          methods.reset(llmConfigToPromptConfigFormValues(restoredConfig));
        })
        .catch((error) => {
          logger.error(error);
          toaster.error({
            title: "Failed to restore version",
            description: error.message,
          });
        });
    },
    [refetchSavedConfig, methods]
  );

  return (
    <form style={{ width: "100%", height: "100%" }}>
      <VStack width="full" height="full" gap={6} mb={6}>
        <VStack width="full" gap={6} mb={6} paddingBottom="70px">
          <PromptHandleInfo configId={configId} />
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
          <VersionHistoryButton
            configId={configId}
            label="History"
            onRestore={handleRestore}
          />
          <Spacer />
          <VersionSaveButton
            disabled={!saveEnabled}
            onClick={handleSaveClick}
            isSaving={isLoading}
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
        <InnerPromptConfigForm {...props} />
      </PromptConfigProvider>
    </FormProvider>
  );
}
