import { HttpOttlTransformChannel } from "./http/http.ottl-transform.channel.ts";
import { MemoryOttlTransformChannel } from "./memory/memory.ottl-transform.channel.ts";
import { HttpCopilotStudioChannel } from "./http/http.copilot-studio.channel.ts";
import { HttpCopilotStudioDataverseChannel } from "./http/http.copilot-studio-dataverse.channel.ts";
import { MemoryCopilotStudioChannel } from "./memory/memory.copilot-studio.channel.ts";
import { MemoryCopilotStudioDataverseChannel } from "./memory/memory.copilot-studio-dataverse.channel.ts";

/** The live and memory tiers for governance's external channels. */
export const governanceChannels = {
  ottlTransform: {
    live: HttpOttlTransformChannel,
    memory: MemoryOttlTransformChannel,
  },
  copilotStudio: {
    live: HttpCopilotStudioChannel,
    memory: MemoryCopilotStudioChannel,
  },
  copilotStudioDataverse: {
    live: HttpCopilotStudioDataverseChannel,
    memory: MemoryCopilotStudioDataverseChannel,
  },
};
