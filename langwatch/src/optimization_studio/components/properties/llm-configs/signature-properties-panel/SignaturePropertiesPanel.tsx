import { type Node } from "@xyflow/react";
import { VStack } from "@chakra-ui/react";
import { BasePropertiesPanel } from "../../BasePropertiesPanel";
import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import type {
  LlmPromptConfigComponent,
  Signature,
} from "../../../../types/dsl";

import { SignaturePropertiesPanelForm } from "./SignaturePropertiesPanelForm";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";

/**
 * Panel for the Signature node in the optimization studio.
 */
export function SignaturePropertiesPanel({
  node,
}: {
  node: Node<Signature | LlmPromptConfigComponent>;
}) {
  const { isInsideWizard } = useWizardContext();

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
          />
        </VStack>
      </PromptConfigProvider>
    </BasePropertiesPanel>
  );
}
