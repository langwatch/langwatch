// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PullerAdapter registry bootstrap. Importing this module wires the
 * built-in adapters into the singleton registry — the pull effect
 * imports it once at startup and then dispatches lookups by adapter id.
 *
 * Add new adapters by registering them here AND exporting them from
 * this module so admin-UI source-type discovery picks them up.
 */
import { PullerRegistryService } from "@langwatch/enterprise-governance-server";
import { AnthropicAdminPuller } from "./anthropicAdmin.puller";
import { ClaudeComplianceReferencePuller } from "./claudeCompliance.puller";
import { CopilotStudioReferencePuller } from "./copilotStudio.puller";
import { DatabricksGeniePuller } from "./databricksGenie.puller";
import { HttpPollingPullerAdapter } from "./httpPollingPullerAdapter";
import { OpenAiComplianceReferencePuller } from "./openaiCompliance.puller";
import { S3PollingPullerAdapter } from "./s3PollingPullerAdapter";

const pullerAdapterRegistry = PullerRegistryService.create();
let registered = false;

export function registerBuiltInPullers(): void {
  if (registered) return;
  pullerAdapterRegistry.register(new HttpPollingPullerAdapter());
  pullerAdapterRegistry.register(new S3PollingPullerAdapter());
  pullerAdapterRegistry.register(new CopilotStudioReferencePuller());
  pullerAdapterRegistry.register(new OpenAiComplianceReferencePuller());
  pullerAdapterRegistry.register(new ClaudeComplianceReferencePuller());
  pullerAdapterRegistry.register(new AnthropicAdminPuller());
  pullerAdapterRegistry.register(new DatabricksGeniePuller());
  registered = true;
}

export {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  type AnthropicAdminPullConfig,
  anthropicAdminPullConfigSchema,
} from "./anthropicAdmin.puller";
export { CLAUDE_COMPLIANCE_PULL_CONFIG } from "./claudeCompliance.puller";
export { COPILOT_STUDIO_PULL_CONFIG } from "./copilotStudio.puller";
export {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  databricksGeniePullConfigSchema,
} from "./databricksGenie.puller";
export type { HttpPollingConfig } from "./httpPollingPullerAdapter";
export { OPENAI_COMPLIANCE_PULL_CONFIG } from "./openaiCompliance.puller";
export type {
  NormalizedPullEvent,
  GovernancePuller as PullerAdapter,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
export type { S3PollingConfig } from "./s3PollingPullerAdapter";
export {
  AnthropicAdminPuller,
  ClaudeComplianceReferencePuller,
  CopilotStudioReferencePuller,
  DatabricksGeniePuller,
  HttpPollingPullerAdapter,
  OpenAiComplianceReferencePuller,
  pullerAdapterRegistry,
  S3PollingPullerAdapter,
};
