import { Text, Spinner, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { PromptConfigForm } from "./forms/prompt-config-form/PromptConfigForm";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";
import { PanelHeader } from "./components/ui/PanelHeader";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { llmConfigToPromptConfigFormValues } from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { InputOutputExecutablePanel } from "~/components/InputOutputExecutablePanel";
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

  if (!isOpen) {
    return null;
  }

  return (
    <InputOutputExecutablePanel
      isExpanded={isExpanded}
      onCloseExpanded={() => setIsExpanded(false)}
    >
      <InputOutputExecutablePanel.LeftDrawer>
        Left drawer
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
        Right drawer
      </InputOutputExecutablePanel.RightDrawer>
    </InputOutputExecutablePanel>
  );
}
