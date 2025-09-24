import { type Node } from "@xyflow/react";

import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import type {
  LlmPromptConfigComponent,
  Signature,
} from "../../../../types/dsl";

import { useLegacyNodeMigration } from "./hooks/use-legacy-node-migration.hook";
import { SignaturePropertiesPanelInner } from "./SignaturePropertiesPanelInner";
import { SignaturePropertiesPanelLoadingState } from "./SignaturePropertiesPanelLoadingState";

import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";

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
  const nodeHasConfigId = "configId" in node.data;

  // Handle legacy node migration (only outside wizard)
  useLegacyNodeMigration(node, { skip: isInsideWizard });

  // Render loading state for while migrating legacy nodes (only outside wizard)
  if (!nodeHasConfigId && !isInsideWizard) {
    return <SignaturePropertiesPanelLoadingState node={node} isInsideWizard={isInsideWizard} />;
  }

  // Render the main panel
  return (
    <PromptConfigProvider>
      <SignaturePropertiesPanelInner
        node={node as Node<LlmPromptConfigComponent>}
      />
    </PromptConfigProvider>
  );
}