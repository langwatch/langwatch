import { defineChannels } from "@langwatch/process";

import { HttpWorkflowChannels } from "./http/http.workflow.channels.ts";
import { MemoryWorkflowChannels } from "./memory/memory.workflow.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const workflowChannels = defineChannels({
  live: HttpWorkflowChannels,
  memory: MemoryWorkflowChannels,
});
