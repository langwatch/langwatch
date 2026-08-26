// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PullerAdapter registry bootstrap. Importing this module wires the
 * built-in adapters into the singleton registry — the pull effect
 * imports it once at startup and then dispatches lookups by adapter id.
 *
 * Add new adapters by registering them here AND exporting them from
 * this module so admin-UI source-type discovery picks them up.
 */
import { AnthropicAdminPuller } from "./anthropicAdmin.puller";
import { ClaudeComplianceReferencePuller } from "./claudeCompliance.puller";
import { CopilotStudioReferencePuller } from "./copilotStudio.puller";
import { CopilotStudioDataversePuller } from "./copilotStudioDataverse.puller";
import { DatabricksGeniePuller } from "./databricksGenie.puller";
import { HttpPollingPullerAdapter } from "./httpPollingPullerAdapter";
import { OpenAiAdminPuller } from "./openaiAdmin.puller";
import { OpenAiComplianceReferencePuller } from "./openaiCompliance.puller";
import { pullerAdapterRegistry } from "./pullerAdapter";
import { S3PollingPullerAdapter } from "./s3PollingPullerAdapter";

let registered = false;

export function registerBuiltInPullers(): void {
  if (registered) return;
  pullerAdapterRegistry.register(new HttpPollingPullerAdapter());
  pullerAdapterRegistry.register(new S3PollingPullerAdapter());
  // Still registered though it is retired: rows already configured on it
  // exist, and an unregistered adapter fails their runs with "unknown
  // adapter" rather than anything an admin can act on.
  pullerAdapterRegistry.register(new CopilotStudioReferencePuller());
  pullerAdapterRegistry.register(new CopilotStudioDataversePuller());
  pullerAdapterRegistry.register(new OpenAiComplianceReferencePuller());
  pullerAdapterRegistry.register(new ClaudeComplianceReferencePuller());
  pullerAdapterRegistry.register(new AnthropicAdminPuller());
  pullerAdapterRegistry.register(new OpenAiAdminPuller());
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
  type CopilotStudioDataverseConfig,
  copilotStudioDataversePullConfigSchema,
} from "./copilotStudioDataverse.puller";
export {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  databricksGeniePullConfigSchema,
} from "./databricksGenie.puller";
export { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./dataverseEnvironment";
export type { HttpPollingConfig } from "./httpPollingPullerAdapter";
export {
  OPENAI_ADMIN_ADAPTER_ID,
  type OpenAiAdminPullConfig,
  openaiAdminPullConfigSchema,
} from "./openaiAdmin.puller";
export { OPENAI_COMPLIANCE_PULL_CONFIG } from "./openaiCompliance.puller";
export type {
  NormalizedPullEvent,
  PullerAdapter,
  PullResult,
  PullRunOptions,
} from "./pullerAdapter";
export type { S3PollingConfig } from "./s3PollingPullerAdapter";
export {
  AnthropicAdminPuller,
  ClaudeComplianceReferencePuller,
  CopilotStudioDataversePuller,
  CopilotStudioReferencePuller,
  DatabricksGeniePuller,
  HttpPollingPullerAdapter,
  OpenAiAdminPuller,
  OpenAiComplianceReferencePuller,
  pullerAdapterRegistry,
  S3PollingPullerAdapter,
};
