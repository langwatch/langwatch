import type { LocalPromptConfig } from "~/evaluations-v3/types";
import type { PromptConfigFormValues } from "~/prompts/types";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";

type ConfigData = PromptConfigFormValues["version"]["configData"];

/**
 * Narrows `json_schema: unknown` from the local-config shape to the form's
 * `{ type: string, ...passthrough }` shape. Drops the value if it doesn't
 * structurally match; the init useEffect later re-merges server data over
 * the seed, so losing a malformed json_schema on first render is fine.
 */
const normalizeOutputs = (
  outputs: LocalPromptConfig["outputs"],
): ConfigData["outputs"] =>
  outputs.map(({ json_schema, ...rest }) => {
    if (
      json_schema &&
      typeof json_schema === "object" &&
      "type" in json_schema &&
      typeof (json_schema as { type: unknown }).type === "string"
    ) {
      return {
        ...rest,
        json_schema: json_schema as ConfigData["outputs"][number]["json_schema"],
      };
    }
    return rest;
  });

/**
 * Builds form values seeded with a caller-supplied local prompt config, padded
 * with form-level defaults for fields not present on `LocalPromptConfig`
 * (handle, scope, commit metadata, etc.).
 *
 * Why: `usePromptConfigForm`'s watch subscription fires synchronously on
 * first render with whatever `configValues` is at mount. If we initialize
 * with bare defaults, the first fire carries the default `input`/`output`
 * fields and clobbers the caller's local edits before the init effect
 * below can reset them — this is the #3155 race condition.
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
