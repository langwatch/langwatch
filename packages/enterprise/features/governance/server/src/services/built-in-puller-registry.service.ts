import { AnthropicAdminPuller } from "../adapters/anthropic-admin-puller.anthropic-admin-puller.adapter";
import { ClaudeComplianceReferencePuller } from "../adapters/claude-compliance-puller.claude-compliance-puller.adapter";
import { CopilotStudioReferencePuller } from "../adapters/copilot-studio-puller.copilot-studio-puller.adapter";
import { DatabricksGeniePuller } from "../adapters/databricks-genie-puller.databricks-genie-puller.adapter";
import { HttpPollingPullerAdapter } from "../adapters/http-poller.http-poller.adapter";
import { OpenAiComplianceReferencePuller } from "../adapters/openai-compliance-puller.openai-compliance-puller.adapter";
import { S3PollingPullerAdapter } from "../adapters/s3-puller.s3-puller.adapter";
import type { GovernanceHttpPort } from "../ports/governance-http.port";
import type { GovernanceObjectStoragePort } from "../ports/governance-object-storage.port";
import type { IngestionPullDiagnosticsPort } from "../ports/ingestion-pull-worker.port";
import { PullerRegistryService } from "./puller-registry.service";

export class BuiltInPullerRegistryService {
  private constructor(private readonly registry: PullerRegistryService) {}

  static create(options: {
    http: GovernanceHttpPort;
    objects: GovernanceObjectStoragePort;
    diagnostics?: IngestionPullDiagnosticsPort;
  }): BuiltInPullerRegistryService {
    const registry = PullerRegistryService.create();
    registry.register(
      HttpPollingPullerAdapter.create({
        http: options.http,
        diagnostics: options.diagnostics,
      }),
    );
    registry.register(
      S3PollingPullerAdapter.create({
        objects: options.objects,
        diagnostics: options.diagnostics,
      }),
    );
    registry.register(
      CopilotStudioReferencePuller.create({
        http: options.http,
        diagnostics: options.diagnostics,
      }),
    );
    registry.register(
      OpenAiComplianceReferencePuller.create({
        objects: options.objects,
        diagnostics: options.diagnostics,
      }),
    );
    registry.register(
      ClaudeComplianceReferencePuller.create({
        http: options.http,
        diagnostics: options.diagnostics,
      }),
    );
    registry.register(AnthropicAdminPuller.create(options.http));
    registry.register(DatabricksGeniePuller.create(options.http));
    return new BuiltInPullerRegistryService(registry);
  }

  build(): PullerRegistryService {
    return this.registry;
  }
}
