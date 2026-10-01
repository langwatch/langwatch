// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  copilotStudioDataversePullConfigSchema,
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { CopilotBotsChannel } from "../channels/copilot-bots.channel.ts";
import type { GenieSpacesChannel } from "../channels/genie-spaces.channel.ts";
import type { ProviderSignInChannel } from "../channels/provider-sign-in.channel.ts";
import type { DiscoveredAgentRepository } from "../repositories/discovered-agent.repository.ts";
import {
  type AgentListing,
  type AgentListingRefusal,
  agentsRefused,
} from "../rules/agent-listing.rules.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../rules/dataverse-environment-service.rules.ts";
import { type AgentListingSourceType } from "../rules/listing-source-types.rules.ts";
import { refusalFromListingThrow } from "../rules/provider-sign-in.rules.ts";
import type {
  SourceCredentialAccessService,
  SourceCredentialContext,
} from "./source-credential-access.service.ts";

/** What one sync did, in the three shapes the listing itself comes in. */
export type AgentSyncResult =
  | { outcome: "listed"; recorded: number }
  | { outcome: "empty" }
  | { outcome: "refused"; refusal: AgentListingRefusal };

type AgentLister = (args: {
  context: SourceCredentialContext;
  signal?: AbortSignal;
}) => Promise<AgentListing>;

interface AgentDiscoveryDependencies {
  agents: DiscoveredAgentRepository;
  sourceCredentials: SourceCredentialAccessService;
  signIn: ProviderSignInChannel;
  genieSpaces: GenieSpacesChannel;
  copilotBots: CopilotBotsChannel;
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
    };
    this.listers = new Map(Object.entries(byType));
  }

  static create({
    logger = createLogger("langwatch:governance:agent-discovery"),
    ...deps
  }: Omit<AgentDiscoveryDependencies, "logger"> & { logger?: Logger }): AgentDiscoveryService {
    return new AgentDiscoveryService({ ...deps, logger });
  }

  /** `now` is passed in so a sweep stamps every source with one instant. */
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
        listing: await this.listAgentsForSource({ context, signal }),
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
    if (listing.outcome === "empty") return { outcome: "empty" };

    for (const agent of listing.items) {
      await this.deps.agents.recordAgentSighting({
        organizationId,
        provider,
        rawAgentId: agent.rawAgentId,
        displayText: agent.displayText,
        metadata: agent.metadata,
        seenAt: now,
      });
    }
    return { outcome: "listed", recorded: listing.items.length };
  }

  /** A source type with no agent list refuses rather than failing, so one source cannot break a sweep. */
  private async listAgentsForSource({
    context,
    signal,
  }: {
    context: SourceCredentialContext;
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    const lister = this.listers.get(context.sourceType);
    if (!lister) return agentsRefused({ reason: "not_configured", status: null });
    return lister({ context, signal });
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
