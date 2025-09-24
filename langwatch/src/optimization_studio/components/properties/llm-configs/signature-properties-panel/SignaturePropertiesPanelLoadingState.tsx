import { Spinner } from "@chakra-ui/react";
import { type Node } from "@xyflow/react";

import type { Signature } from "../../../../types/dsl";
import { BasePropertiesPanel } from "../../BasePropertiesPanel";

export function SignaturePropertiesPanelLoadingState({ node, isInsideWizard }: { node: Node<Signature>, isInsideWizard: boolean }) {
  return (
      <BasePropertiesPanel
        node={node}
        hideParameters
        hideInputs
        hideOutputs
        {...(isInsideWizard && {
          hideHeader: true,
          width: "full",
          maxWidth: "full",
        })}
      >
        <Spinner />
      </BasePropertiesPanel>
  )
}