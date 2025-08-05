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

import { PanelHeader } from "./components/ui/PanelHeader";
import { PromptConfigForm } from "./forms/prompt-config-form/PromptConfigForm";
import { useInvokePrompt } from "./hooks/useInvokePrompt";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";

import { LuBuilding } from "react-icons/lu";
import {
  ExecutionInputPanel,
  type ExecuteData,
} from "~/components/executable-panel/ExecutionInputPanel";
import { ExecutionOutputPanel } from "~/components/executable-panel/ExecutionOutputPanel";
import {
  InputOutputExecutablePanel,
  PANEL_ANIMATION_DURATION,
} from "~/components/executable-panel/InputOutputExecutablePanel";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  llmConfigToPromptConfigFormValues,
  promptConfigFormValuesToOptimizationStudioNodeData,
} from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { Tooltip } from "../components/ui/tooltip";

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

export const PromptConfigPanel = forwardRef(function PromptConfigPanel(
  {
    isOpen,
    onClose,
    configId,
    isPaneExpanded: isExpanded,
    setIsPaneExpanded: setIsExpanded,
  }: PromptConfigPanelProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  // ---- State and hooks ----
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  // ---- API calls and data fetching ----
  const {
    reset,
    mutate: invokeLLM,
    isLoading: isExecuting,
    data: promptExecutionResult,
  } = useInvokePrompt({
    mutationKey: ["prompt-config", configId],
  });

  useEffect(() => {
    const shouldReset = !isOpen || !isExpanded || !configId;
    if (shouldReset) {
      reset();
    }
  }, [isOpen, isExpanded, configId, reset]);

  // Fetch the LLM configuration
  const { data: llmConfig, isLoading: isLoadingConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId,
      },
      {
        enabled: !!projectId && !!configId,
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: false,
      }
    );

  // ---- Form setup and configuration ----
  // Transform the LLM config into form values
  const initialConfigValues = useMemo(
    () =>
      llmConfig ? llmConfigToPromptConfigFormValues(llmConfig) : undefined,
    [configId, projectId, !!llmConfig]
  );

  // Setup form with the config values
  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
  });

  // Get input fields from the form
  const inputFields = formProps.methods.getValues("version.configData.inputs");

  // ---- Effects and handlers ----
  // Reset form when config changes
  useEffect(() => {
    if (initialConfigValues) {
      formProps.methods.reset(initialConfigValues);
    }
  }, [formProps.methods, initialConfigValues]);

  const handleClose = () => {
    if (isExpanded) {
      setIsExpanded(false);
    } else {
      onClose();
    }
  };

  // Handle prompt execution with current form data and inputs
  const handleExecute = (inputData: ExecuteData) => {
    if (!llmConfig) {
      return;
    }

    const formData = formProps.methods.getValues();
    // Update inputs with values from the input panel
    formData.version.configData.inputs = inputFields?.map((input) => ({
      ...input,
      value: inputData[input.identifier],
    }));

    invokeLLM({
      projectId,
      data: promptConfigFormValuesToOptimizationStudioNodeData(
        llmConfig,
        formData
      ),
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
    }
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
                {llmConfig?.latestVersion && llmConfig.handle && (
                  <Badge
                    colorPalette="green"
                    border="1px solid"
                    borderColor="green.200"
                  >
                    v{llmConfig?.latestVersion.version}
                  </Badge>
                )}
                {llmConfig?.scope === "ORGANIZATION" && (
                  <Tooltip content="This prompt is available to all projects in the organization">
                    <Button
                      onClick={() => {
                        // Hack to call the edit handle dialog, as triggering from here and dealing with all the provider context shaneningans is too complicated
                        const button =
                          document.querySelector<HTMLButtonElement>(
                            "#js-edit-prompt-handle"
                          );
                        if (button) {
                          button.click();
                        }
                      }}
                      variant="plain"
                      asChild
                      size="xs"
                    >
                      <Badge colorPalette="purple" variant="outline">
                        <HStack>
                          <LuBuilding />
                          Organization
                        </HStack>
                      </Badge>
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
            llmConfig && <PromptConfigForm {...formProps} />
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
