import type { Field } from "@langwatch/workflow-contract";
import type { TargetConfig } from "../../../experiment-workbench.ts";
import { type SetTargetPromptPayload, setTargetPromptPayloadSchema } from "../schemas.ts";
import { requireTarget } from "./helpers.ts";
import type { Transform } from "./types.ts";

/**
 * Write the target's draft prompt.
 */
export const setTargetPrompt: Transform<SetTargetPromptPayload, { targetId: string }> = ({
  state,
  payload,
}) => {
  const { targetId, localPromptConfig, inputs, outputs } =
    setTargetPromptPayloadSchema.parse(payload);
  const target = requireTarget({ state, targetId });

  const updated: TargetConfig = {
    ...target,
    localPromptConfig,
    ...(inputs ? { inputs: inputs as Field[] } : {}),
    ...(outputs ? { outputs: outputs as Field[] } : {}),
  };

  return {
    state: {
      ...state,
      targets: state.targets.map((t) => (t.id === targetId ? updated : t)),
    },
    result: { targetId },
  };
};
