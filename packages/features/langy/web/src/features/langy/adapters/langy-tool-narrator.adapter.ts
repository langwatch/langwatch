import type { LangyToolNarrator } from "../../../index";
import { describeToolCall, effectiveToolName } from "../logic/langyToolLabel";

export const langyToolNarrator: LangyToolNarrator = {
  describe({ name, toolInput }) {
    return describeToolCall({
      name: effectiveToolName(name, toolInput),
      input: toolInput,
    });
  },
};
