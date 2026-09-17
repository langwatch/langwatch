import type { PullResult, PullRunOptions } from "@langwatch/enterprise-governance-contract";
import { COPILOT_STUDIO_PULL_CONFIG } from "../http/http.copilot-studio.channel.ts";
import type { HttpPollingConfig } from "../http/http.polling.channel.ts";
import type { CopilotStudioPullerChannel } from "../copilot-studio.channel.ts";

/** Memory twin for tests that do not contact Microsoft Graph. */
export class MemoryCopilotStudioChannel implements CopilotStudioPullerChannel {
  static readonly requires: readonly [] = [];

  private constructor(private readonly result: PullResult) {}

  static create(result: PullResult = { events: [], cursor: null, errorCount: 0 }) {
    return new MemoryCopilotStudioChannel(result);
  }

  readonly id = "copilot_studio";

  validateConfig(_config: unknown): HttpPollingConfig {
    return COPILOT_STUDIO_PULL_CONFIG;
  }

  async runOnce(_options: PullRunOptions, _config: HttpPollingConfig): Promise<PullResult> {
    return this.result;
  }
}
