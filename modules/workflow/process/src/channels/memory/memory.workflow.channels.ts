import { UnconfiguredWorkflowNlpRuntimeAdapter } from "../http/http.workflow-nlp-runtime.channel.ts";
import { UnconfiguredWorkflowStudioStreamAdapter } from "../http/http.workflow-studio-stream.channel.ts";
import type { WorkflowChannels } from "../workflow.channels.ts";
import { MemoryWorkflowProviderSpendChannel } from "./memory.workflow-provider-spend.channel.ts";

const REASON = "This process runs the memory tier, which has no NLP engine to reach.";

/** No engine is reached: every studio stream and run refuses by name; spend is kept in memory. */
export class MemoryWorkflowChannels {
  static readonly requires = [] as const;

  static create(): WorkflowChannels {
    return {
      spend: MemoryWorkflowProviderSpendChannel.create(),
      engine: {
        kind: "single",
        stream: UnconfiguredWorkflowStudioStreamAdapter.create({ reason: REASON }),
        runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create({ reason: REASON }),
        perProjectEngines: false,
      },
    };
  }
}
