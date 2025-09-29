import { type Node } from "@xyflow/react";
import { VStack } from "@chakra-ui/react";
import debounce from "lodash-es/debounce";
import { useMemo } from "react";

import { BasePropertiesPanel } from "../../BasePropertiesPanel";

import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import type {
  LlmPromptConfigComponent,
  Signature,
} from "../../../../types/dsl";

import { useLegacyNodeMigration } from "./hooks/use-legacy-node-migration.hook";
import { SignaturePropertiesPanelForm } from "./SignaturePropertiesPanelForm";
import { SignaturePropertiesPanelLoadingState } from "./SignaturePropertiesPanelLoadingState";

import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";
import { promptConfigFormValuesToOptimizationStudioNodeData } from "~/prompt-configs/llmPromptConfigUtils";
import { type PromptConfigFormValues } from "~/prompt-configs";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";

/**
 * Wrapper component that provides the PromptConfigProvider context
 * to the inner panel component. Handles node creation for legacy nodes
 * when not in wizard context.
 *
 * The wizard will create a legacy node object that it will hold in state,
 * which then is passed into this panel. However, on save or when outside of the wizard,
 * we want to create the actual llm prompt config in the database and use that data.
 */
export function SignaturePropertiesPanel({
  node,
}: {
  node: Node<Signature | LlmPromptConfigComponent>;
}) {
  const { isInsideWizard } = useWizardContext();
  const configId = (node.data as LlmPromptConfigComponent).configId;
  const setNode = useSmartSetNode();

  /**
   * Converts form values to node data and updates the workflow store.
   * This ensures the node's data stays in sync with the form state.
   *
   * We use useMemo to create the debounced function to prevent unnecessary re-renders.
   *
   * @param formValues - The current form values to sync with node data
   */
  const syncNodeDataWithFormValues = useMemo(
    () =>
      debounce((formValues: PromptConfigFormValues) => {
        const updatedNodeData =
          promptConfigFormValuesToOptimizationStudioNodeData(formValues);

        setNode({
          id: node.id,
          data: {
            handle: formValues.handle,
            name: formValues.handle ?? node.data.name ?? "",
            configId,
            ...updatedNodeData,
          },
        });
      }, 200),
    [node.id, setNode, configId, node.data.name]
  );

  // Render the main panel
  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      hideInputs
      hideOutputs
      hideDescription
      {...(isInsideWizard && {
        hideHeader: true,
        width: "full",
        maxWidth: "full",
        paddingX: "0",
      })}
    >
      <PromptConfigProvider>
        <VStack width="full" gap={4}>
          <SignaturePropertiesPanelForm
            node={node as Node<LlmPromptConfigComponent>}
            onFormValuesChange={syncNodeDataWithFormValues}
          />
        </VStack>
      </PromptConfigProvider>
    </BasePropertiesPanel>
  );
}
