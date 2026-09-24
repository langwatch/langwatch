// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentListingUnavailableError,
  type AgentsListingOutcome,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import {
  type AgentListingRequestCommand,
  agentListingRequests,
  listableAgentSources,
} from "../rules/agent-listing-request.rules.ts";
import {
  type AgentsListingSummary,
  deriveAgentsListingOutcome,
} from "../rules/agents-listing-outcome.rules.ts";
import { schedulerWillPull } from "../rules/pull-schedule.rules.ts";

/** What one press dispatches, per source. Returns once the ask is recorded. */
export type AgentListingDispatcher = (command: AgentListingRequestCommand) => Promise<unknown>;

/** A source the screen may name, and may ask. */
export interface AgentSyncSource {
  id: string;
  name: string;
  sourceType: string;
}

/** A source the screen may name, plus how the last ask of it ended (`null`: never recorded). */
export interface AgentSyncSourceListing extends AgentSyncSource {
  lastListing: AgentsListingOutcome | null;
}

export interface AgentListingRequestResult {
  /** How many sources were asked. Never how many answered. */
  requested: number;
  sources: AgentSyncSource[];
}

interface GovernanceAgentSyncDependencies {
  sources: IngestionSourceRepository;
  projects: Pick<ProjectApi, "findInternal">;
  /** The run-status projection's read of how each source's last listing ended. */
  listings: {
    findAgentsListings(input: {
      sourceIds: readonly string[];
      projectId: string;
    }): Promise<Map<string, AgentsListingSummary>>;
  };
  dispatch: AgentListingDispatcher;
  newRequestId: () => string;
  logger: Logger;
}

const toSyncSource = (source: AgentSyncSource): AgentSyncSource => ({
  id: source.id,
  name: source.name,
  sourceType: source.sourceType,
});

/**
 * Asks the organization's providers what agents they have, and returns what was ASKED, never what
 * was found: the pipeline answers later. A second press while one runs is dropped by the process.
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
export class GovernanceAgentSyncService {
  private constructor(private readonly deps: GovernanceAgentSyncDependencies) {}

  static create({
    newRequestId = () => generate("governance").toString(),
    logger = createLogger("langwatch:governance:agent-sync"),
    ...deps
  }: Omit<GovernanceAgentSyncDependencies, "newRequestId" | "logger"> & {
    newRequestId?: () => string;
    logger?: Logger;
  }): GovernanceAgentSyncService {
    return new GovernanceAgentSyncService({ ...deps, newRequestId, logger });
  }

  /** A separate door so a read never depends on the pipeline; a read reaching a dispatch is a wiring mistake. */
  static forReads(
    deps: Pick<GovernanceAgentSyncDependencies, "sources" | "projects" | "listings">,
  ): GovernanceAgentSyncService {
    return GovernanceAgentSyncService.create({
      ...deps,
      dispatch: () => {
        throw new Error("GovernanceAgentSyncService.forReads cannot dispatch a listing");
      },
    });
  }

  /** On the view grant: an empty table still has to say which providers it speaks for. */
  async listableSources({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentSyncSource[]> {
    return (await this.listableSourceRows({ organizationId })).map(toSyncSource);
  }

  /** Decorates {@link listableSources}, never a second query deciding the set for itself. */
  async listableSourcesWithLastListing({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentSyncSourceListing[]> {
    const sources = await this.listableSources({ organizationId });
    if (sources.length === 0) return [];

    const projectId = await this.governanceProjectId({ organizationId });
    const listings = projectId
      ? await this.deps.listings.findAgentsListings({
          sourceIds: sources.map((source) => source.id),
          projectId,
        })
      : new Map<string, AgentsListingSummary>();

    return sources.map((source) => ({
      ...source,
      lastListing: deriveAgentsListingOutcome(listings.get(source.id)),
    }));
  }

  /** Asks every listable source the scheduler will pull; nothing to ask is zero, not an error. */
  async requestListing({
    organizationId,
    now = nowInstant().epochMilliseconds,
  }: {
    organizationId: string;
    now?: number;
  }): Promise<AgentListingRequestResult> {
    const sources = (await this.listableSourceRows({ organizationId }))
      .filter(schedulerWillPull)
      .map(toSyncSource);
    if (sources.length === 0) return { requested: 0, sources: [] };

    const tenantId = await this.governanceProjectId({ organizationId });
    if (!tenantId) throw new AgentListingUnavailableError("no_governance_project");

    const requestId = this.deps.newRequestId();
    const commands = agentListingRequests({ sources, tenantId, requestId, now });
    for (const command of commands) {
      await this.deps.dispatch(command);
    }

    this.deps.logger.info(
      { organizationId, requestId, requested: commands.length },
      "Requested an agent listing from every listable source",
    );

    return { requested: commands.length, sources };
  }

  private async listableSourceRows({ organizationId }: { organizationId: string }) {
    return listableAgentSources(await this.deps.sources.findAll(organizationId));
  }

  /** Read-only: asking must never provision the organization's governance project. */
  private async governanceProjectId({ organizationId }: { organizationId: string }) {
    const project = await this.deps.projects.findInternal({
      organizationId,
      kind: "internal_governance",
    });
    return project?.id ?? null;
  }
}
