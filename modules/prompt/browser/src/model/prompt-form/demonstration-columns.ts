import type { DatasetColumnType } from "@langwatch/dataset-contract";
import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import type {
  LlmConfigInputType,
  LlmConfigOutputType,
  NodeDataset,
} from "@langwatch/workflow-contract";
import isEqual from "lodash-es/isEqual";

export function inputsAndOutputsToDemostrationColumns(
  inputs: PromptConfigFormValues["version"]["configData"]["inputs"],
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"],
): { name: string; type: DatasetColumnType; id: string }[] {
  return [
    ...(inputs ?? [])
      .filter(({ type }) => type !== "image" && type !== "file")
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
 * The demonstrations a stored prompt settles on once it is in the form. Columns are DERIVED
 * from the prompt's inputs and outputs, since a stored prompt carries none of its own — without
 * this, a dirty baseline taken from the document would differ from the form on load.
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
    case "file":
      throw new Error("File is not supported in demonstrations");
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
      throw new Error(`Unknown input/output type: ${JSON.stringify(type_)}`);
  }
}
