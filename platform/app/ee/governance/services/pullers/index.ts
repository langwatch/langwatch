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
import { DatabricksGeniePuller } from "./databricksGenie.puller";
import { HttpPollingPullerAdapter } from "./httpPollingPullerAdapter";
import { Microsoft365AuditPuller } from "./microsoft365Audit.puller";
import { OpenAiComplianceReferencePuller } from "./openaiCompliance.puller";
import { pullerAdapterRegistry } from "./pullerAdapter";
import { S3PollingPullerAdapter } from "./s3PollingPullerAdapter";

let registered = false;

export function registerBuiltInPullers(): void {
  if (registered) return;
  pullerAdapterRegistry.register(new HttpPollingPullerAdapter());
  pullerAdapterRegistry.register(new S3PollingPullerAdapter());
  pullerAdapterRegistry.register(new Microsoft365AuditPuller());
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
export {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  databricksGeniePullConfigSchema,
} from "./databricksGenie.puller";
export type { HttpPollingConfig } from "./httpPollingPullerAdapter";
export type { Microsoft365AuditConfig } from "./microsoft365Audit.puller";
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
  DatabricksGeniePuller,
  HttpPollingPullerAdapter,
  Microsoft365AuditPuller,
  OpenAiComplianceReferencePuller,
  pullerAdapterRegistry,
  S3PollingPullerAdapter,
};
