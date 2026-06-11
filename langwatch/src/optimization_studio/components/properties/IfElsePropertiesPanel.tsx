import { HStack, Link, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { ExternalLink } from "react-feather";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import { Switch } from "~/components/ui/switch";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Field } from "../../types/dsl";
import { LiquidConditionEditor } from "../code/LiquidConditionEditor";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";

const LIQUID_OPERATORS_DOCS = "https://shopify.github.io/liquid/basics/operators/";

function pythonAnnotation(type: Field["type"]): string {
  switch (type) {
    case "str":
      return ": str";
    case "float":
      return ": float";
    case "bool":
      return ": bool";
    default:
      return "";
  }
}

/**
 * Starter for the python condition: receives the node inputs as
 * arguments, must return True or False to pick the branch.
 */
function pythonConditionTemplate(inputs: Field[]): string {
  const args = inputs
    .map((input) => `${input.identifier}${pythonAnnotation(input.type)}`)
    .join(", ");
  const firstInput = inputs[0]?.identifier;
  const returnLine = firstInput ? `return ${firstInput} != ""` : "return True";
  return `def execute(${args}) -> bool:\n    # Return True to take the true branch, False otherwise.\n    ${returnLine}\n`;
}

/**
 * Drawer for the if/else gate. The condition is either a Liquid boolean
 * expression (same language as prompt templates) or, with the Code
 * toggle on, a python function that receives the inputs and returns
 * True/False. The engine routes execution down the true or false branch
 * handle and skips the not-taken side; the branch outputs are the
 * gating contract, so they render read-only.
 */
export function IfElsePropertiesPanel({ node }: { node: Node<Component> }) {
  const { setNodeParameter } = useWorkflowStore(
    useShallow((state) => ({
      setNodeParameter: state.setNodeParameter,
    })),
  );

  const param = useCallback(
    (identifier: string) =>
      (node.data.parameters?.find((p) => p.identifier === identifier)
        ?.value as string | undefined) ?? "",
    [node.data.parameters],
  );

  const condition = param("condition");
  const code = param("code");
  const isCode = param("condition_language") === "python";

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

  const handleCodeChange = useCallback(
    (value: string) => {
      setNodeParameter(node.id, {
        identifier: "code",
        type: "code",
        value,
      });
    },
    [setNodeParameter, node.id],
  );

  const handleLanguageToggle = useCallback(
    (checked: boolean) => {
      setNodeParameter(node.id, {
        identifier: "condition_language",
        type: "str",
        value: checked ? "python" : "liquid",
      });
      if (checked && !code.trim()) {
        setNodeParameter(node.id, {
          identifier: "code",
          type: "code",
          value: pythonConditionTemplate(node.data.inputs ?? []),
        });
      }
    },
    [setNodeParameter, node.id, code, node.data.inputs],
  );

  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      outputsTitle="Branches"
      outputsReadOnly
    >
      <VStack width="full" align="start" gap={2}>
        <HStack width="full">
          <PropertySectionTitle>Condition</PropertySectionTitle>
          <Spacer />
          <Switch
            size="sm"
            checked={isCode}
            onCheckedChange={({ checked }) => handleLanguageToggle(checked)}
            data-testid="if-else-code-toggle"
          >
            Code
          </Switch>
        </HStack>
        {isCode ? (
          <>
            <CodeBlockEditor
              code={code}
              onChange={handleCodeChange}
              language="python"
              inputs={(node.data.inputs ?? []).map((i) => ({
                identifier: i.identifier,
                type: i.type,
              }))}
              viewStateKey={`if-else-condition:${node.id}`}
            />
            <Text fontSize="12px" color="fg.muted">
              Python over the inputs, must return True or False. The
              not-taken branch is skipped.
            </Text>
          </>
        ) : (
          <>
            <LiquidConditionEditor
              value={condition}
              onChange={handleConditionChange}
              placeholder={'e.g. context != ""'}
            />
            <Text fontSize="12px" color="fg.muted">
              <Link
                href={LIQUID_OPERATORS_DOCS}
                target="_blank"
                rel="noreferrer"
                color="fg.muted"
                textDecoration="underline"
              >
                Liquid condition
                <ExternalLink
                  size={11}
                  style={{ display: "inline", marginLeft: "2px" }}
                />
              </Link>{" "}
              over the inputs. The not-taken branch is skipped.
            </Text>
          </>
        )}
      </VStack>
    </BasePropertiesPanel>
  );
}
