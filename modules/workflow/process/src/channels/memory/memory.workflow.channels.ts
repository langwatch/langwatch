import { UnconfiguredWorkflowNlpRuntimeAdapter } from "../http/http.workflow-nlp-runtime.channel.ts";
import { UnconfiguredWorkflowStudioStreamAdapter } from "../http/http.workflow-studio-stream.channel.ts";
import type { WorkflowChannels } from "../workflow.channels.ts";

const REASON = "This process runs the memory tier, which has no NLP engine to reach.";

/** No engine is reached: every studio stream and run refuses by name. */
export class MemoryWorkflowChannels {
  static readonly requires = [] as const;

  static create(): WorkflowChannels {
    return {
      engine: {
        kind: "single",
        stream: UnconfiguredWorkflowStudioStreamAdapter.create({ reason: REASON }),
        runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create({ reason: REASON }),
        perProjectEngines: false,
      },
    };
  }
}
