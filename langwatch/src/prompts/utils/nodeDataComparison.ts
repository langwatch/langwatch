import type { Node } from "@xyflow/react";
import { isEqual } from "lodash-es";

import type {
  LlmPromptConfigComponent,
  NodeDataset,
} from "~/optimization_studio/types/dsl";

/**
 * Checks if a demonstrations dataset has any records.
 */
function hasRecords(demonstrations: NodeDataset | undefined): boolean {
  if (!demonstrations?.inline?.records) return false;
  return Object.keys(demonstrations.inline.records).length > 0;
}

/**
 * Normalizes node data for comparison by sorting arrays and filtering optional fields.
 * @param nodeData - The node data to standardize
 * @param includeDemonstrations - Whether to include demonstrations parameter in comparison
 * @returns Normalized node data object
 */
function standardizeNodeData(
  nodeData: Node<LlmPromptConfigComponent>["data"],
  includeDemonstrations: boolean,
) {
  return JSON.parse(
    JSON.stringify({
      handle: nodeData.handle,
      inputs: nodeData.inputs
        ?.map((input) => ({
          identifier: input.identifier,
          type: input.type,
        }))
        .sort((a, b) => a.identifier.localeCompare(b.identifier)),
      outputs: nodeData.outputs
        ?.map((output) => ({
          identifier: output.identifier,
          type: output.type,
        }))
        .sort((a, b) => a.identifier.localeCompare(b.identifier)),
      parameters: [...nodeData.parameters]
        .filter(
          (param) =>
            param.identifier !== "demonstrations" || includeDemonstrations,
        )
        .map((param) => {
          if (param.identifier === "demonstrations" && includeDemonstrations) {
            const records = param.value?.inline?.records ?? {};
            return {
              identifier: param.identifier,
              type: param.type,
              value: {
                inline: {
                  records,
                },
              },
            };
          }
          return {
            identifier: param.identifier,
            type: param.type,
            value: param.value,
          };
        })
        .sort((a, b) => a.identifier.localeCompare(b.identifier)),
    }),
  );
}

/**
 * Compares two node data objects for semantic equality.
 * Ignores array ordering and optional fields like name, configId, and versionMetadata.
 * Only includes demonstrations parameter if at least one node has demonstration records.
 *
 * @param nodeData1 - First node data to compare
 * @param nodeData2 - Second node data to compare
 * @returns True if the nodes are semantically equal
 */
export function isNodeDataEqual(
  nodeData1: Node<LlmPromptConfigComponent>["data"],
  nodeData2: Node<LlmPromptConfigComponent>["data"],
): boolean {
  const demo1 = nodeData1.parameters.find(
    (p) => p.identifier === "demonstrations",
  )?.value as NodeDataset | undefined;
  const demo2 = nodeData2.parameters.find(
    (p) => p.identifier === "demonstrations",
  )?.value as NodeDataset | undefined;

  const includeDemonstrations = hasRecords(demo1) || hasRecords(demo2);

  return isEqual(
    standardizeNodeData(nodeData1, includeDemonstrations),
    standardizeNodeData(nodeData2, includeDemonstrations),
  );
}
