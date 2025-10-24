import { Badge, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  forwardRef,
  useEffect,
  useMemo,
  type Dispatch,
  type ForwardedRef,
  type SetStateAction,
} from "react";
import { useDebouncedCallback } from "use-debounce";

import { useInvokePrompt } from "./hooks/useInvokePrompt";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";

import {
  ExecutionInputPanel,
  type ExecuteData,
} from "~/components/executable-panel/ExecutionInputPanel";
import { ExecutionOutputPanel } from "~/components/executable-panel/ExecutionOutputPanel";
import {
  InputOutputExecutablePanel,
  PANEL_ANIMATION_DURATION,
} from "~/components/executable-panel/InputOutputExecutablePanel";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  promptConfigFormValuesToOptimizationStudioNodeData,
  versionedPromptToPromptConfigFormValues,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { PanelHeader } from "./components/ui/PanelHeader";
import { PromptConfigForm } from "./forms/prompt-config-form/PromptConfigForm";
import type { PromptConfigFormValues } from "./types";
import { buildDefaultFormValues } from "./utils/buildDefaultFormValues";
import { OrganizationBadge } from "./components/ui/OrganizationBadge";
import { VersionBadge } from "./components/ui/VersionBadge";

/**
 * Panel for configuring and testing LLM prompts
 */
interface PromptConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  isPaneExpanded: boolean;
  setIsPaneExpanded: Dispatch<SetStateAction<boolean>>;
}

/**
 * Panel for configuring and testing LLM prompts
 * When the prompt is not found, it will show the default values
 */
export const PromptConfigPanel = forwardRef(function PromptConfigPanel(
  {
    isOpen,
    onClose,
    configId,
    isPaneExpanded: isExpanded,
    setIsPaneExpanded: setIsExpanded,
  }: PromptConfigPanelProps,
  ref: ForwardedRef<HTMLDivElement>,
) {
  // ---- State and hooks ----
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const defaultModel = project?.defaultModel;

  // ---- API calls and data fetching ----
  const {
    reset,
    mutate: invokeLLM,
    isLoading: isExecuting,
    data: promptExecutionResult,
  } = useInvokePrompt({
    mutationKey: ["prompt-config", configId],
  });

  // Fetch the LLM configuration
  const { data: prompt, isLoading: isLoadingConfig } =
    api.prompts.getByIdOrHandle.useQuery(
      {
        idOrHandle: configId,
        projectId,
      },
      {
        enabled: !!projectId && !!configId,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    );

  // ---- Form setup and configuration ----
  // Transform the LLM config into form values
  const initialConfigValues: PromptConfigFormValues = useMemo(
    () => {
      // If prompt is found, use the prompt values
      return prompt
        ? versionedPromptToPromptConfigFormValues(prompt)
        : // If default model is set, use the default model merged with the default values
        typeof defaultModel === "string"
        ? buildDefaultFormValues({
            version: { configData: { llm: { model: defaultModel } } },
          })
        : // If no default model is set, use the default values
          buildDefaultFormValues({});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(prompt), defaultModel, configId],
  );

  // Setup form with the config values
  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
  });

  // Reset inputs when panel is closed
  useEffect(() => {
    const shouldResetInputs = !isOpen || !isExpanded || !configId;
    if (shouldResetInputs) {
      reset();
    }
  }, [isOpen, isExpanded, configId, reset]);

  // Reset form when config changes
  useEffect(() => {
    formProps.methods.reset(initialConfigValues);
  }, [initialConfigValues, formProps.methods]);

  // Get input fields from the form
  const inputFields = formProps.methods.getValues("version.configData.inputs");

  const handleClose = () => {
    if (isExpanded) {
      setIsExpanded(false);
    } else {
      onClose();
    }
  };

  // Handle prompt execution with current form data and inputs
  const handleExecute = (inputData: ExecuteData) => {
    const formData = formProps.methods.getValues();
    // Update inputs with values from the input panel
    formData.version.configData.inputs = inputFields?.map((input) => ({
      ...input,
      value: inputData[input.identifier],
    }));

    invokeLLM({
      projectId,
      data: {
        name: formData.handle ?? "Anonymous", // REQUIRED FOR INVOKING LLM
        ...promptConfigFormValuesToOptimizationStudioNodeData(formData),
      },
    });
  };

  // Debounce the expand/collapse state change to prevent weird animation glitches
  // when changing state mid-animation.
  const handleExpand = useDebouncedCallback(
    () => {
      setIsExpanded((prev) => !prev);
    },
    PANEL_ANIMATION_DURATION * 1000,
    {
      leading: true,
      trailing: false,
    },
  );

  // Early return if panel is closed
  if (!isOpen) {
    return null;
  }

  // ---- Render component ----
  return (
    <InputOutputExecutablePanel
      isExpanded={isExpanded}
      onCloseExpanded={() => setIsExpanded(false)}
      ref={ref}
    >
      <InputOutputExecutablePanel.LeftDrawer>
        <ExecutionInputPanel fields={inputFields} onExecute={handleExecute} />
      </InputOutputExecutablePanel.LeftDrawer>

      <InputOutputExecutablePanel.CenterContent>
        <VStack width="full" gap={4} height="full" background="white">
          <PanelHeader
            title={
              <HStack>
                <Text whiteSpace="nowrap">Prompt Configuration</Text>
                {prompt?.version && prompt?.handle && (
                  <VersionBadge version={prompt.version} />
                )}
                {prompt?.scope === "ORGANIZATION" && (
                  <Tooltip content="This prompt is available to all projects in the organization">
                    <Button
                      onClick={() => {
                        // Hack to call the edit handle dialog, as triggering from here and dealing with all the provider context shaneningans is too complicated
                        const button =
                          document.querySelector<HTMLButtonElement>(
                            "#js-edit-prompt-handle",
                          );
                        if (button) {
                          button.click();
                        }
                      }}
                      variant="plain"
                      asChild
                      size="xs"
                    >
                      <OrganizationBadge />
                    </Button>
                  </Tooltip>
                )}
              </HStack>
            }
            onClose={handleClose}
            onExpand={handleExpand}
          />
          {isLoadingConfig ? (
            <Spinner size="md" />
          ) : (
            <PromptConfigForm {...formProps} />
          )}
        </VStack>
      </InputOutputExecutablePanel.CenterContent>

      <InputOutputExecutablePanel.RightDrawer>
        <ExecutionOutputPanel
          isTracingEnabled={true}
          executionState={
            isExecuting
              ? { status: "running" }
              : promptExecutionResult?.executionState
          }
        />
      </InputOutputExecutablePanel.RightDrawer>
    </InputOutputExecutablePanel>
  );
});
