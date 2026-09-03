import type { TargetConfig } from "../../types";
import { type UpdateTargetModelPayload, updateTargetModelPayloadSchema } from "../schemas";
import { requireTarget } from "./helpers";
import { type Transform, TransformError } from "./types";

/**
 * Point a target's draft prompt at another model.
 *
 * Requires an existing `localPromptConfig`: the rest of a prompt (messages,
 * inputs, outputs) lives in the prompt registry, and a config invented from a
 * model name alone would run an empty prompt. Load the prompt into the draft
 * first (`workbench.setTargetPrompt`), then switch its model.
 */
export const updateTargetModel: Transform<
  UpdateTargetModelPayload,
  { targetId: string; model: string }
> = ({ state, payload }) => {
  const { targetId, model } = updateTargetModelPayloadSchema.parse(payload);
  const target = requireTarget({ state, targetId });

  if (!target.localPromptConfig) {
    throw new TransformError({
      code: "target_prompt_config_missing",
      message: `Target ${targetId} has no draft prompt config to set a model on`,
      meta: { targetId },
    });
  }

  const updated: TargetConfig = {
    ...target,
    localPromptConfig: {
      ...target.localPromptConfig,
      llm: { ...target.localPromptConfig.llm, model },
    },
  };

  return {
    state: {
      ...state,
      targets: state.targets.map((t) => (t.id === targetId ? updated : t)),
    },
    result: { targetId, model },
  };
};
