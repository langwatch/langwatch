import { Text, Spinner, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import {
  ExecutionInputPanel,
  type ExecuteData,
} from "~/components/executable-panel/ExecutionInputPanel";
import { PromptConfigForm } from "./forms/prompt-config-form/PromptConfigForm";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";
import { PanelHeader } from "./components/ui/PanelHeader";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  llmConfigToPromptConfigFormValues,
  promptConfigFormValuesToOptimizationStudioNodeData,
} from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { InputOutputExecutablePanel } from "~/components/executable-panel/InputOutputExecutablePanel";
import { useExecutePrompt } from "./hooks/useInvokePrompt";
import { ExecutionOutputPanel } from "~/components/executable-panel/ExecutionOutputPanel";

/**
 * Panel for configuring and testing LLM prompts
 */
interface PromptConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
}

export function PromptConfigPanel({
  isOpen,
  onClose,
  configId,
}: PromptConfigPanelProps) {
  // ---- State and hooks ----
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const [isExpanded, setIsExpanded] = useState(false);

  // ---- API calls and data fetching ----
  const {
    mutate: invokeLLM,
    isLoading: isExecuting,
    data: promptExecutionResult,
  } = useExecutePrompt();

  // Fetch the LLM configuration
  const { data: llmConfig, isLoading: isLoadingConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId,
      },
      {
        enabled: !!projectId && !!configId,
        staleTime: 30000, // Reduce refetches for better performance
      }
    );

  // ---- Form setup and configuration ----
  // Transform the LLM config into form values
  const initialConfigValues = useMemo(
    () =>
      llmConfig ? llmConfigToPromptConfigFormValues(llmConfig) : undefined,
    [llmConfig]
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
  }, [configId, formProps.methods, initialConfigValues]);

  const handleClose = () => {
    setIsExpanded(false);
    onClose();
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
      data: promptConfigFormValuesToOptimizationStudioNodeData(
        configId,
        formData
      ),
    });
  };

  // Early return if panel is closed
  if (!isOpen) {
    return null;
  }

  // ---- Render component ----
  return (
    <InputOutputExecutablePanel
      isExpanded={isExpanded}
      onCloseExpanded={() => setIsExpanded(false)}
    >
      <InputOutputExecutablePanel.LeftDrawer>
        <ExecutionInputPanel fields={inputFields} onExecute={handleExecute} />
      </InputOutputExecutablePanel.LeftDrawer>

      <InputOutputExecutablePanel.CenterContent>
        <VStack width="full" gap={4} height="full" background="white">
          <PanelHeader
            title={<Text>Prompt Configuration</Text>}
            onClose={handleClose}
            onExpand={() => setIsExpanded((prev) => !prev)}
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
          executionState={
            isExecuting
              ? { status: "running" }
              : promptExecutionResult?.executionState
          }
          isTracingEnabled={false}
        />
      </InputOutputExecutablePanel.RightDrawer>
    </InputOutputExecutablePanel>
  );
}
