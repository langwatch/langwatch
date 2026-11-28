// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ARD_REGISTRY_ADAPTER_ID,
  ardRegistryPullConfigSchema,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  awsBedrockAgentsPullConfigSchema,
  copilotStudioDataversePullConfigSchema,
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
  GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
  gcpVertexAgentEnginePullConfigSchema,
  type TestAgentListingResult,
} from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type {
  ArdRegistryChannel,
  AwsAgentInventoryChannel,
  VertexAgentEngineChannel,
} from "../../../channels/cloud-agent-inventory.channel.ts";
import type { CopilotBotsChannel } from "../../../channels/copilot-bots.channel.ts";
import type { GenieSpacesChannel } from "../../../channels/genie-spaces.channel.ts";
import type { ProviderSignInChannel } from "../../../channels/provider-sign-in.channel.ts";
import type { DiscoveredAgentRepository } from "../../../repositories/discovered-agent.repository.ts";
import type {
  GovernanceAwsConnectionRepository,
  GovernanceAwsCredentials,
} from "../../../repositories/governance-aws-connection.repository.ts";
import type {
  SourceCredentialAccessService,
  SourceCredentialContext,
} from "../../ingestion-source/services/source-credential-access.service.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../microsoft/rules/dataverse-environment-service.rules.ts";
import type { AgentRegistryService } from "../../registry/services/agent-registry.service.ts";
import {
  type AgentListing,
  type AgentListingRefusal,
  agentsRefused,
} from "../rules/agent-listing.rules.ts";
import { type AgentListingSourceType } from "../rules/listing-source-types.rules.ts";
import { refusalFromListingThrow } from "../rules/provider-sign-in.rules.ts";

/** What one sync did, in the three shapes the listing itself comes in. */
export type AgentSyncResult =
  | { outcome: "listed"; recorded: number }
  | { outcome: "empty" }
  | { outcome: "refused"; refusal: AgentListingRefusal };

type AgentLister = (args: {
  organizationId: string;
  context: SourceCredentialContext;
  signal?: AbortSignal;
}) => Promise<AgentListing>;

const NOT_CONFIGURED = { reason: "not_configured", status: null } as const;

interface AgentDiscoveryDependencies {
  agents: DiscoveredAgentRepository;
  sourceCredentials: SourceCredentialAccessService;
  signIn: ProviderSignInChannel;
  genieSpaces: GenieSpacesChannel;
  copilotBots: CopilotBotsChannel;
  awsAgentInventory: AwsAgentInventoryChannel;
  vertexAgentEngine: VertexAgentEngineChannel;
  ardRegistry: ArdRegistryChannel;
  /** The AWS connections an AWS source signs with, read for the source's own organisation only. */
  awsConnections: Pick<GovernanceAwsConnectionRepository, "getCredentials">;
  /** The agent registry, reconciled after a listing so new or renamed agents are announced. */
  registry?: Pick<AgentRegistryService, "reconcileOrganization">;
  logger: Logger;
}

/**
 * The feed that discovers agents by asking the provider. A refusal writes nothing: it is not
 * evidence an agent stopped existing. Each config parse sits outside the `try` scoped to the
 * network calls, so a DNS failure can never read as an unconfigured source.
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
export class AgentDiscoveryService {
  /** Keyed by the listable types so a provider without a lister fails to compile; a Map so a column value cannot reach the prototype. */
  private readonly listers: ReadonlyMap<string, AgentLister>;

  private constructor(private readonly deps: AgentDiscoveryDependencies) {
    const byType: Record<AgentListingSourceType, AgentLister> = {
      [DATABRICKS_GENIE_ADAPTER_ID]: (args) => this.listGenieAgents(args),
      [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID]: (args) => this.listCopilotAgents(args),
      [AWS_BEDROCK_AGENTS_ADAPTER_ID]: (args) => this.listAwsAgents(args),
      [GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID]: (args) => this.listVertexAgents(args),
      [ARD_REGISTRY_ADAPTER_ID]: (args) => this.listArdAgents(args),
    };
    this.listers = new Map(Object.entries(byType));
  }

  static create({
    logger = createLogger("langwatch:governance:agent-discovery"),
    ...deps
  }: Omit<AgentDiscoveryDependencies, "logger"> & { logger?: Logger }): AgentDiscoveryService {
    return new AgentDiscoveryService({ ...deps, logger });
  }

  /**
   * `now` is passed in so a sweep stamps every source with one instant. A listing that answers
   * (even empty) marks the source's agents it no longer names gone; a refusal marks nothing.
   */
  async syncFromSource({
    organizationId,
    ingestionSourceId,
    now,
    signal,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    now: Instant;
    signal?: AbortSignal;
  }): Promise<AgentSyncResult> {
    const { provider, listing } = await this.deps.sourceCredentials.withSourceCredentials({
      organizationId,
      ingestionSourceId,
      use: async (context) => ({
        provider: context.sourceType,
        listing: await this.listAgentsForSource({ organizationId, context, signal }),
      }),
    });

    if (listing.outcome === "refused") {
      this.deps.logger.warn(
        {
          organizationId,
          ingestionSourceId,
          reason: listing.refusal.reason,
          status: listing.refusal.status,
        },
        "provider would not list its agents; leaving the recorded agents as they are",
      );
      return { outcome: "refused", refusal: listing.refusal };
    }
    if (listing.outcome === "empty") {
      const { marked } = await this.deps.agents.markUnlistedGone({
        organizationId,
        ingestionSourceId,
        listedAt: now,
      });
      if (marked > 0) await this.reconcileRegistry({ organizationId });
      return { outcome: "empty" };
    }

    for (const agent of listing.items) {
      await this.deps.agents.recordAgentSighting({
        organizationId,
        provider,
        rawAgentId: agent.rawAgentId,
        displayText: agent.displayText,
        metadata: agent.metadata,
        seenAt: now,
        ingestionSourceId,
      });
    }
    await this.deps.agents.markUnlistedGone({ organizationId, ingestionSourceId, listedAt: now });
    await this.reconcileRegistry({ organizationId });
    return { outcome: "listed", recorded: listing.items.length };
  }

  /** A saved source's listing, recorded nowhere: the source form's test connection. */
  async testListingForSource({
    organizationId,
    ingestionSourceId,
    signal,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    signal?: AbortSignal;
  }): Promise<TestAgentListingResult> {
    const listing = await this.deps.sourceCredentials.withSourceCredentials({
      organizationId,
      ingestionSourceId,
      use: (context) => this.listAgentsForSource({ organizationId, context, signal }),
    });
    return testResultOf(listing);
  }

  /** An unsaved configuration's listing, recorded nowhere: the source form's test before save. */
  async testListingForConfig({
    organizationId,
    sourceType,
    config,
    credentials,
    signal,
  }: {
    organizationId: string;
    sourceType: string;
    config: Record<string, unknown>;
    credentials: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<TestAgentListingResult> {
    const { credentials: _sealed, ...plainConfig } = config;
    const listing = await this.listAgentsForSource({
      organizationId,
      context: { sourceId: "", sourceType, config: plainConfig, credentials },
      signal,
    });
    return testResultOf(listing);
  }

  /** A registry that fails to reconcile does not fail the listing; the next trigger retries it. */
  private async reconcileRegistry({ organizationId }: { organizationId: string }): Promise<void> {
    if (!this.deps.registry) return;
    try {
      await this.deps.registry.reconcileOrganization({ organizationId });
    } catch (error) {
      this.deps.logger.warn(
        { organizationId, error },
        "agent registry reconcile after a listing failed; the next trigger retries it",
      );
    }
  }

  /** A source type with no agent list refuses rather than failing, so one source cannot break a sweep. */
  private async listAgentsForSource({
    organizationId,
    context,
    signal,
  }: {
    organizationId: string;
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const lister = this.listers.get(context.sourceType);
    if (!lister) return agentsRefused(NOT_CONFIGURED);
    return lister({ organizationId, context, signal });
  }

  /** The connection is read for the source's own organisation, so another's id is not configured. */
  private async listAwsAgents({
    organizationId,
    context,
    signal,
  }: {
    organizationId: string;
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const parsed = awsBedrockAgentsPullConfigSchema.safeParse(context.config);
    if (!parsed.success) return agentsRefused(NOT_CONFIGURED);
    const { awsConnectionId, regions } = parsed.data;

    let credentials: GovernanceAwsCredentials;
    try {
      credentials = await this.deps.awsConnections.getCredentials({
        organizationId,
        id: awsConnectionId,
      });
    } catch (error) {
      if (isAwsConnectionMissing(error)) return agentsRefused(NOT_CONFIGURED);
      throw error;
    }
    return this.deps.awsAgentInventory.listAgents({ credentials, regions, signal });
  }

  private async listVertexAgents({
    context,
    signal,
  }: {
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const parsed = gcpVertexAgentEnginePullConfigSchema.safeParse(context.config);
    const serviceAccountJson = context.credentials.serviceAccountJson;
    if (!parsed.success || !serviceAccountJson) return agentsRefused(NOT_CONFIGURED);
    return this.deps.vertexAgentEngine.listAgents({
      serviceAccountJson,
      targets: parsed.data.targets,
      signal,
    });
  }

  private async listArdAgents({
    context,
    signal,
  }: {
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const parsed = ardRegistryPullConfigSchema.safeParse(context.config);
    if (!parsed.success) return agentsRefused(NOT_CONFIGURED);
    const { registryUrl, searchUrl } = parsed.data;
    const bearerToken = context.credentials.bearerToken;
    return this.deps.ardRegistry.listAgents({
      registryUrl,
      ...(searchUrl ? { searchUrl } : {}),
      ...(bearerToken ? { bearerToken } : {}),
      signal,
    });
  }

  private async listGenieAgents({
    context,
    signal,
  }: {
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const parsed = databricksGeniePullConfigSchema.safeParse(context.config);
    if (!parsed.success) return agentsRefused({ reason: "not_configured", status: null });
    const { workspaceUrl } = parsed.data;

    try {
      const token = await this.deps.signIn.getWorkspaceToken({
        credentials: context.credentials,
        workspaceUrl,
        signal,
      });
      return await this.deps.genieSpaces.listAgents({ workspaceUrl, token, signal });
    } catch (error) {
      return agentsRefused(refusalFromListingThrow(error));
    }
  }

  private async listCopilotAgents({
    context,
    signal,
  }: {
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const parsed = copilotStudioDataversePullConfigSchema.safeParse(context.config);
    if (!parsed.success) return agentsRefused({ reason: "not_configured", status: null });
    const { environmentUrl } = parsed.data;

    try {
      const token = await this.deps.signIn.getEnvironmentToken({
        credentials: context.credentials,
        environmentUrl,
        signal,
      });
      return await this.deps.copilotBots.listAgents({ environmentUrl, token, signal });
    } catch (error) {
      return agentsRefused(refusalFromListingThrow(error));
    }
  }
}

function isAwsConnectionMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "governance_aws_connection_not_found"
  );
}

function testResultOf(listing: AgentListing): TestAgentListingResult {
  if (listing.outcome === "refused") {
    return {
      outcome: "refused",
      reason: listing.refusal.reason,
      status: listing.refusal.status,
    };
  }
  if (listing.outcome === "empty") return { outcome: "empty" };
  return { outcome: "listed", agentCount: listing.items.length };
}
