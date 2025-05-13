import { Text, Spinner, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { InputPanel } from "~/components/executable-panel/InputPanel";
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
import { useExecutePrompt } from "./hooks/useExecutePrompt";
import isEqual from "lodash.isequal";
import { ExecutionOutputPanel } from "~/components/executable-panel/ExecutionOutputPanel";

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
  const { project } = useOrganizationTeamProject();
  const {
    mutate: executePrompt,
    isLoading: isExecuting,
    data: promptExecutionResult,
  } = useExecutePrompt();
  const projectId = project?.id ?? "";
  const { data: llmConfig } = api.llmConfigs.getByIdWithLatestVersion.useQuery(
    {
      id: configId,
      projectId,
    },
    { enabled: !!projectId && !!configId }
  );
  const initialConfigValues = useMemo(() => {
    return llmConfig ? llmConfigToPromptConfigFormValues(llmConfig) : undefined;
  }, [llmConfig]);

  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
  });

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    formProps.methods.reset(initialConfigValues);
  }, [configId, formProps.methods, initialConfigValues]);

  const handleClose = () => {
    setIsExpanded(false);
    onClose();
  };

  const inputFields = formProps.methods.getValues("version.configData.inputs");

  if (!isOpen) {
    return null;
  }

  return (
    <InputOutputExecutablePanel
      isExpanded={isExpanded}
      onCloseExpanded={() => setIsExpanded(false)}
    >
      <InputOutputExecutablePanel.LeftDrawer>
        <InputPanel
          fields={inputFields}
          onExecute={(data) => {
            const formData = formProps.methods.getValues();
            // Set the inputs to the form data
            formData.version.configData.inputs = inputFields?.map((input) => ({
              ...input,
              value: data[input.identifier],
            }));
            executePrompt({
              projectId,
              data: promptConfigFormValuesToOptimizationStudioNodeData(
                configId,
                formData
              ),
            });
          }}
        />
      </InputOutputExecutablePanel.LeftDrawer>
      <InputOutputExecutablePanel.CenterContent>
        <VStack width="full">
          <PanelHeader
            title={<Text>Prompt Configuration</Text>}
            onClose={handleClose}
            onExpand={() => setIsExpanded((prev) => !prev)}
          />
          {llmConfig ? <PromptConfigForm {...formProps} /> : <Spinner />}
        </VStack>
      </InputOutputExecutablePanel.CenterContent>
      <InputOutputExecutablePanel.RightDrawer>
        <ExecutionOutputPanel
          executionState={promptExecutionResult?.executionState}
          isTracingEnabled={false}
        />
      </InputOutputExecutablePanel.RightDrawer>
    </InputOutputExecutablePanel>
  );
}
