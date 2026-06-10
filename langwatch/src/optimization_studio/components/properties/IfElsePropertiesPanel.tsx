import { Field, Input, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component } from "../../types/dsl";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";

/**
 * Drawer for the if/else gate. The condition is a Liquid boolean
 * expression - the same template language as prompts - evaluated over
 * the node's inputs; the engine routes execution down the true or
 * false branch handle and skips the not-taken side. The branch outputs
 * are the engine's gating contract, so they render read-only.
 */
export function IfElsePropertiesPanel({ node }: { node: Node<Component> }) {
  const { setNodeParameter } = useWorkflowStore(
    useShallow((state) => ({
      setNodeParameter: state.setNodeParameter,
    })),
  );

  const condition =
    (node.data.parameters?.find((p) => p.identifier === "condition")
      ?.value as string | undefined) ?? "";

  const handleConditionChange = useCallback(
    (value: string) => {
      setNodeParameter(node.id, {
        identifier: "condition",
        type: "str",
        value,
      });
    },
    [setNodeParameter, node.id],
  );

  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      outputsTitle="Branches"
      outputsReadOnly
    >
      <VStack width="full" align="start" gap={2}>
        <PropertySectionTitle>Condition</PropertySectionTitle>
        <Field.Root>
          <Input
            value={condition}
            fontFamily="monospace"
            fontSize="13px"
            placeholder={'e.g. context != ""'}
            data-testid="if-else-condition-input"
            onChange={(e) => handleConditionChange(e.target.value)}
          />
        </Field.Root>
        <Text fontSize="12px" color="fg.muted">
          Liquid expression over the inputs, like in prompt templates:
          {" "}
          <Text as="span" fontFamily="monospace">
            context != &quot;&quot;
          </Text>
          ,{" "}
          <Text as="span" fontFamily="monospace">
            score &gt; 0.5
          </Text>
          {" or "}
          <Text as="span" fontFamily="monospace">
            a != &quot;&quot; and b != &quot;&quot;
          </Text>
          . Nodes connected to the not-taken branch are skipped.
        </Text>
      </VStack>
    </BasePropertiesPanel>
  );
}
