import type { Field } from "@langwatch/workflow-contract";
import type { TargetConfig } from "../../types";
import { type SetTargetPromptPayload, setTargetPromptPayloadSchema } from "../schemas";
import { requireTarget } from "./helpers";
import type { Transform } from "./types";

/**
 * Write the target's draft prompt.
 *
 * `localPromptConfig` is the unsaved buffer the workbench runs from until the
 * user saves the prompt back to the prompt registry, so this is how a prompt
 * edit lands without touching the saved version. Inputs and outputs travel with
 * it: a changed message set usually changes the variables the target needs.
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
