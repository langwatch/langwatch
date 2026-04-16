import type { LocalPromptConfig } from "~/evaluations-v3/types";
import type { PromptConfigFormValues } from "~/prompts/types";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import type { DeepPartial } from "~/utils/types";

type ConfigData = PromptConfigFormValues["version"]["configData"];

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

  const overrides = {
    version: {
      configData: {
        llm: local.llm,
        messages: local.messages as ConfigData["messages"],
        inputs: local.inputs as ConfigData["inputs"],
        outputs: local.outputs as ConfigData["outputs"],
      },
    },
  } satisfies DeepPartial<PromptConfigFormValues>;

  return buildDefaultFormValues(overrides);
};
