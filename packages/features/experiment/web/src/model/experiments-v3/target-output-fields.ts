import type { TargetConfig } from "./types";

/**
 * A prompt's output field as it arrives from the API / prompt editor.
 *
 * `json_schema` is nullable coming off the prompt row, hence `| null`.
 */
export type PromptOutputField = {
  identifier: string;
  type: string;
  json_schema?: object | null;
};

/**
 * Copy a prompt's output fields onto a workbench target.
 */
export const toTargetOutputFields = (
  outputs: PromptOutputField[] | undefined,
): TargetConfig["outputs"] =>
  (outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as NonNullable<TargetConfig["outputs"]>[number]["type"],
    ...(output.json_schema ? { json_schema: output.json_schema } : {}),
  })) as TargetConfig["outputs"];
