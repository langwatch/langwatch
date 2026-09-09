import type { LocalPromptConfig } from "@langwatch/experiment-web/surfaces/workbench-types";
import { buildDefaultFormValues } from "../../surfaces/prompt-form/index.ts";
import { type PromptConfigFormValues } from "@langwatch/prompt-contract";

type ConfigData = PromptConfigFormValues["version"]["configData"];

/**
 * Narrows `json_schema: unknown` to the form's `{ type, ...passthrough }`
 * shape, dropping it if it doesn't match — the init useEffect re-merges
 * server data over the seed, so losing it on first render is fine.
 */
const normalizeOutputs = (outputs: LocalPromptConfig["outputs"]): ConfigData["outputs"] =>
  outputs.map(({ json_schema, ...rest }) => {
    const schemaType =
      json_schema && typeof json_schema === "object"
        ? (json_schema as { type?: unknown }).type
        : undefined;
    const isTypedSchema = typeof schemaType === "string";
    if (isTypedSchema) {
      return {
        ...rest,
        json_schema: json_schema as ConfigData["outputs"][number]["json_schema"],
      };
    }
    return rest;
  });

/**
 * Builds form values seeded with a caller-supplied config, padded with
 * defaults for missing fields. Needed since the watch subscription fires
 * synchronously on first render, or bare defaults clobber local edits (#3155).
 */
export const localConfigToFormValues = (
  local: LocalPromptConfig | undefined,
): PromptConfigFormValues => {
  if (!local) return buildDefaultFormValues();

  return buildDefaultFormValues({
    version: {
      configData: {
        llm: local.llm,
        messages: local.messages,
        inputs: local.inputs,
        outputs: normalizeOutputs(local.outputs),
      },
    },
  });
};
