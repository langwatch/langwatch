import type { DatasetColumnType } from "@langwatch/dataset-contract";
import type {
  LlmConfigInputType,
  LlmConfigOutputType,
  NodeDataset,
} from "@langwatch/workflow-contract";
import isEqual from "lodash-es/isEqual";

import type { PromptConfigFormValues } from "./prompt-form.schemas";

export function inputsAndOutputsToDemostrationColumns(
  inputs: PromptConfigFormValues["version"]["configData"]["inputs"],
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"],
): { name: string; type: DatasetColumnType; id: string }[] {
  return [
    ...(inputs ?? [])
      .filter(({ type }) => type !== "image")
      .map((input) => ({
        id: input.identifier,
        name: input.identifier,
        type: inputOutputTypeToDatasetColumnType(input.type),
      })),
    ...(outputs ?? []).map((output) => ({
      id: output.identifier,
      name: output.identifier,
      type: inputOutputTypeToDatasetColumnType(output.type),
    })),
  ];
}

/**
 * The demonstrations a stored prompt settles on once it is in the form.
 *
 * The columns of the demonstrations dataset are DERIVED from the prompt's
 * inputs and outputs: the form recomputes them on load and writes them into
 * itself (`usePromptConfigForm`). A stored prompt carries no columns of its
 * own, so a dirty baseline taken straight from the document differs from the
 * form the moment it loads, and an untouched prompt reads as modified. Deriving
 * them here is what keeps both sides the same shape.
 *
 * Returns the demonstrations untouched, undefined included, when the columns
 * already match: the form leaves them alone in that case, and adding an empty
 * dataset would be the same difference in the other direction.
 */
export function withDerivedDemonstrationColumns({
  demonstrations,
  inputs,
  outputs,
}: {
  demonstrations: NodeDataset | undefined;
  inputs: PromptConfigFormValues["version"]["configData"]["inputs"];
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"];
}): NodeDataset | undefined {
  const columnTypes = inputsAndOutputsToDemostrationColumns(inputs, outputs);
  const current = demonstrations?.inline?.columnTypes ?? [];
  if (isEqual(columnTypes, current)) return demonstrations;

  return {
    ...demonstrations,
    inline: {
      ...demonstrations?.inline,
      columnTypes,
      records: demonstrations?.inline?.records ?? {},
    },
  };
}

function inputOutputTypeToDatasetColumnType(
  type_: LlmConfigInputType | LlmConfigOutputType,
): DatasetColumnType {
  switch (type_) {
    case "str":
      return "string";
    case "float":
      return "number";
    case "bool":
      return "boolean";
    case "list[str]":
      return "list";
    case "image":
      throw new Error("Image is not supported in demonstrations");
    case "json_schema":
      return "json";
    case "list[float]":
      return "list";
    case "list[int]":
      return "list";
    case "list[bool]":
      return "list";
    case "dict":
      return "json";
    case "list":
      return "list";
    case "chat_messages":
      return "json";
    default:
      type_ satisfies never;
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown input/output type: ${type_}`);
  }
}
