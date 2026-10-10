import type {
  GovernancePuller,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";

import type { CopilotStudioDataverseConfig } from "./http/http.copilot-studio-dataverse.channel.ts";

/** Vendor channel for Copilot Studio Dataverse transcript pulls. */
export interface CopilotStudioDataversePullerChannel extends GovernancePuller<CopilotStudioDataverseConfig> {
  readonly id: string;
  validateConfig(config: unknown): CopilotStudioDataverseConfig;
  runOnce(options: PullRunOptions, config: CopilotStudioDataverseConfig): Promise<PullResult>;
}
