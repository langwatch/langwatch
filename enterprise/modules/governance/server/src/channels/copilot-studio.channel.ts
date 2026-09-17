import type {
  GovernancePuller,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import type { HttpPollingConfig } from "../services/http-poller.service.ts";

/** Vendor channel for the locked Microsoft Graph Copilot Studio audit pull. */
export interface CopilotStudioPullerChannel extends GovernancePuller<HttpPollingConfig> {
  readonly id: string;
  validateConfig(config: unknown): HttpPollingConfig;
  runOnce(options: PullRunOptions, config: HttpPollingConfig): Promise<PullResult>;
}
