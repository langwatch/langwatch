import type { PullResult, PullRunOptions } from "@langwatch/enterprise-governance-contract";
import {
  copilotStudioDataversePullConfigSchema,
  type CopilotStudioDataverseConfig,
} from "../http/http.copilot-studio-dataverse.channel.ts";
import type { CopilotStudioDataversePullerChannel } from "../copilot-studio-dataverse.channel.ts";

/** Memory twin for tests that do not contact Dataverse. */
export class MemoryCopilotStudioDataverseChannel implements CopilotStudioDataversePullerChannel {
  static readonly requires: readonly [] = [];

  private constructor(private readonly result: PullResult) {}

  static create(result: PullResult = { events: [], cursor: null, errorCount: 0 }) {
    return new MemoryCopilotStudioDataverseChannel(result);
  }

  readonly id = "copilot_studio_dataverse";

  validateConfig(config: unknown): CopilotStudioDataverseConfig {
    return copilotStudioDataversePullConfigSchema.parse(config);
  }

  async runOnce(
    _options: PullRunOptions,
    _config: CopilotStudioDataverseConfig,
  ): Promise<PullResult> {
    return this.result;
  }
}
