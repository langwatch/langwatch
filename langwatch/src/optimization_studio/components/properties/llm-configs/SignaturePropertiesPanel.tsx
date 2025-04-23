import { Separator, HStack, Button, useDisclosure } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { Save } from "react-feather";
import { FormProvider } from "react-hook-form";

import { SchemaVersion } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type { Signature } from "../../../types/dsl";
import { BasePropertiesPanel } from "../BasePropertiesPanel";

import { PromptSource } from "./prompt-source-select/PromptSource";

import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  llmConfigToNodeData,
  nodeDataToPromptConfigFormInitialValues,
  promptConfigFormValuesToNodeData,
} from "~/optimization_studio/utils/llmPromptConfigUtils";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "~/prompt-configs/forms/fields/PromptNameField";
import {
  SaveVersionDialog,
  type SaveDialogFormValues,
} from "~/prompt-configs/forms/SaveVersionDialog";
import {
  usePromptConfigForm,
  type PromptConfigFormValues,
} from "~/prompt-configs/hooks/usePromptConfigForm";
import { VersionHistoryListPopover } from "~/prompt-configs/VersionHistoryListPopover";
import { api } from "~/utils/api";

/**
 * Properties panel for the Signature node in the optimization studio.
 *
 * A Signature in this context is based on the DSPy concept, which defines
 * an interface for LLM interactions with inputs, outputs, and parameters.
 *
 * This panel allows users to configure:
 * - The LLM model to use for this signature
 * - Instructions for the LLM
 * - Demonstrations (few-shot examples)
 * - Prompting techniques (like Chain of Thought)
 *
 * The Signature node represents an LLM calling component in the workflow
 * that can be connected with other nodes to build complex LLM-powered applications.
 */
export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { open: isSaveVersionDialogOpen, setOpen: setIsSaveVersionDialogOpen } =
    useDisclosure();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const configId = node.data.configId;
  const { setNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
  }));
  const updateConfig = api.llmConfigs.updatePromptConfig.useMutation();
  const createVersion = api.llmConfigs.versions.create.useMutation();

  /**
   * Syncs the node data with the form values.
   * formValues => nodeData
   */
  const syncNodeDataWithFormValues = useCallback(
    (formValues: PromptConfigFormValues) => {
      const newNodeData = promptConfigFormValuesToNodeData(
        configId,
        formValues
      );
      setNode({
        ...node,
        data: newNodeData,
      });
    },
    [node, setNode]
  );

  const initialConfigValues = nodeDataToPromptConfigFormInitialValues(
    node.data
  );
  const formProps = usePromptConfigForm({
    configId,
    initialConfigValues,
    projectId,
    onChange: (formValues) => {
      const shouldUpdate = !isEqual(formValues, initialConfigValues);

      // If the form values have changed, update the node data
      if (shouldUpdate) {
        syncNodeDataWithFormValues(formValues);
      }
    },
  });

  const handlePromptSourceSelect = (config: { id: string; name: string }) => {
    setNode({
      ...node,
      data: {
        ...node.data,
        name: config.name,
        configId,
      },
    });
  };

  const { data: savedConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId,
      },
      { enabled: !!configId && !!projectId }
    );

  const hasDrifted = useMemo(() => {
    if (!savedConfig) return false;
    const savedConfigData = llmConfigToNodeData(savedConfig);
    return !isEqual(node.data, savedConfigData);
  }, [node.data, savedConfig]);

  const handleSaveTrigger = useCallback(async () => {
    const isValid = await formProps.methods.trigger();
    if (!isValid) return;
    setIsSaveVersionDialogOpen(true);
  }, [formProps.methods, setIsSaveVersionDialogOpen]);

  const handleSaveVersion = useCallback(
    async (formValues: SaveDialogFormValues) => {
      console.log("handleSaveVersion", formValues);
      if (!savedConfig) return;

      const formData = formProps.methods.getValues();

      try {
        // Only update name if it changed
        if (formData.name !== savedConfig.name) {
          await updateConfig.mutateAsync({
            projectId,
            id: configId,
            name: formData.name,
          });
        }

        await createVersion.mutateAsync({
          projectId,
          configId,
          configData: formData.version.configData,
          schemaVersion: SchemaVersion.V1_0,
          commitMessage: formValues.commitMessage,
        });

        setIsSaveVersionDialogOpen(false);
      } catch (error) {
        console.error(error);
        toaster.create({
          title: "Error",
          description: "Failed to save version",
          type: "error",
        });
      }
    },
    [
      savedConfig,
      formProps.methods,
      createVersion,
      projectId,
      configId,
      setIsSaveVersionDialogOpen,
      updateConfig,
    ]
  );

  // TODO: Consider refactoring the BasePropertiesPanel so that we don't need to hide everything like this
  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs>
      <VerticalFormControl label="Prompt Source" width="full">
        <HStack justifyContent="space-between">
          <HStack flex={1} width="50%">
            <PromptSource
              configId={node.data.configId}
              onSelect={handlePromptSourceSelect}
            />
          </HStack>
          {node.data.configId && (
            <Button variant="outline" marginLeft={2}>
              <VersionHistoryListPopover configId={node.data.configId} />
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!hasDrifted}
            colorPalette="green"
            onClick={() => void handleSaveTrigger()}
          >
            <Save />
          </Button>
        </HStack>
      </VerticalFormControl>
      <Separator />
      <FormProvider {...formProps.methods}>
        <form style={{ width: "100%" }}>
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
    </BasePropertiesPanel>
  );
}

function isEqual(a: any, b: any) {
  return JSON.stringify(a, null, 2) === JSON.stringify(b, null, 2);
}
