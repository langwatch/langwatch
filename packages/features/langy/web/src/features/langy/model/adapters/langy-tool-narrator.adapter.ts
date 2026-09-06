import type { LangyToolNarrator } from "../../../../model/langy-thinking-line.ts";
import { describeToolCall, effectiveToolName } from "../logic/langy-tool-label.ts";

export const langyToolNarrator: LangyToolNarrator = {
  describe({ name, toolInput }) {
    return describeToolCall({
      name: effectiveToolName(name, toolInput),
      input: toolInput,
    });
  },
};
