// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { LISTING_FAILED_REASON } from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type {
  IngestionPullListingOutcome,
  IngestionPullListingOutcomeChannel,
} from "../app/governance.members.ts";
import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import type { AgentDiscoveryService } from "./agent-discovery.service.ts";
import { INGESTION_PULL_MAX_ATTEMPTS } from "./ingestion-pull.service.ts";
import type { PersonListingService } from "./person-listing.service.ts";

/** One on-demand listing, as the process manager's `listAgents`/`listPeople` intent carries it. */
export type IngestionPullListingRequest = {
  sourceId: string;
  requestId: string;
  requestedAt: number;
};

export type IngestionPullListingExecution = {
  tenantId: string;
  attempt: number;
  listing: IngestionPullListingRequest;
};

type Refused = { outcome: "refused"; reason: string; status: number | null };
type ListingOutcome<Counts> = { outcome: "listed"; counts: Counts } | Refused;

type AgentCounts = { agentCount: number };
type PeopleCounts = { directoryPersonCount: number; withheldPersonCount: number };

const SOURCE_GONE: Refused = { outcome: "refused", reason: "not_found", status: null };

interface IngestionPullListingDependencies {
  sources: Pick<IngestionSourceRepository, "findById">;
  agents: Pick<AgentDiscoveryService, "syncFromSource">;
  people: Pick<PersonListingService, "syncFromSource">;
  outcomes: IngestionPullListingOutcomeChannel;
  maxAttempts: number;
  clock: () => number;
  now: () => Instant;
  logger: Logger;
}

/**
 * A provider refusal records and returns; our own side giving out retries, then records
 * `listing_failed`. Ports main's `createListingHandler` and the agent/people listing ports.
 */
export class IngestionPullListingService {
  private constructor(private readonly deps: IngestionPullListingDependencies) {}

  static create({
    maxAttempts = INGESTION_PULL_MAX_ATTEMPTS,
    clock = Date.now,
    now = nowInstant,
    logger = createLogger("langwatch:governance:ingestion-pull-listing"),
    ...deps
  }: Omit<IngestionPullListingDependencies, "maxAttempts" | "clock" | "now" | "logger"> &
    Partial<
      Pick<IngestionPullListingDependencies, "maxAttempts" | "clock" | "now" | "logger">
    >): IngestionPullListingService {
    return new IngestionPullListingService({ ...deps, maxAttempts, clock, now, logger });
  }

  listAgents(execution: IngestionPullListingExecution): Promise<void> {
    return this.settle<AgentCounts>({
      execution,
      what: "Agent",
      list: (sourceId) => this.findAgents(sourceId),
      recordListed: (args) => this.deps.outcomes.agentsListed(args),
      recordRefused: (args) => this.deps.outcomes.agentsListingRefused(args),
    });
  }

  listPeople(execution: IngestionPullListingExecution): Promise<void> {
    return this.settle<PeopleCounts>({
      execution,
      what: "People",
      list: (sourceId) => this.findPeople(sourceId),
      recordListed: (args) => this.deps.outcomes.peopleListed(args),
      recordRefused: (args) => this.deps.outcomes.peopleListingRefused(args),
    });
  }

  private async settle<Counts>({
    execution,
    what,
    list,
    recordListed,
    recordRefused,
  }: {
    execution: IngestionPullListingExecution;
    what: string;
    list: (sourceId: string) => Promise<ListingOutcome<Counts>>;
    recordListed: (args: IngestionPullListingOutcome & Counts) => Promise<void>;
    recordRefused: (
      args: IngestionPullListingOutcome & { reason: string; status: number | null },
    ) => Promise<void>;
  }): Promise<void> {
    const { listing } = execution;
    const envelope = {
      tenantId: execution.tenantId,
      sourceId: listing.sourceId,
      requestId: listing.requestId,
      requestedAt: listing.requestedAt,
    };

    let result: ListingOutcome<Counts>;
    try {
      result = await list(listing.sourceId);
    } catch (error) {
      this.retryOrGiveUp({ error, execution, what });
      await recordRefused({
        ...envelope,
        occurredAt: this.deps.clock(),
        reason: LISTING_FAILED_REASON,
        status: null,
      });
      return;
    }

    if (result.outcome === "refused") {
      await recordRefused({
        ...envelope,
        occurredAt: this.deps.clock(),
        reason: result.reason,
        status: result.status,
      });
      return;
    }
    await recordListed({ ...envelope, occurredAt: this.deps.clock(), ...result.counts });
  }

  /** The message goes to the log only: the durable event carries a reason code, never provider text. */
  private retryOrGiveUp({
    error,
    execution,
    what,
  }: {
    error: unknown;
    execution: IngestionPullListingExecution;
    what: string;
  }): void {
    const context = {
      sourceId: execution.listing.sourceId,
      requestId: execution.listing.requestId,
      attempt: execution.attempt,
      errorType: error instanceof Error ? error.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    };
    if (execution.attempt >= this.deps.maxAttempts) {
      this.deps.logger.warn(context, `${what} listing failed; attempts spent`);
      return;
    }
    this.deps.logger.warn(context, `${what} listing failed; retrying`);
    throw error;
  }

  private async findOrganizationId(sourceId: string, what: string): Promise<string | undefined> {
    const source = await this.deps.sources.findById(sourceId);
    if (source) return source.organizationId;
    this.deps.logger.warn(
      { ingestionSourceId: sourceId },
      `${what} listing asked for a source that no longer exists`,
    );
    return undefined;
  }

  private async findAgents(sourceId: string): Promise<ListingOutcome<AgentCounts>> {
    const organizationId = await this.findOrganizationId(sourceId, "agent");
    if (organizationId === undefined) return SOURCE_GONE;
    const result = await this.deps.agents.syncFromSource({
      organizationId,
      ingestionSourceId: sourceId,
      now: this.deps.now(),
    });
    if (result.outcome === "refused") {
      return { outcome: "refused", reason: result.refusal.reason, status: result.refusal.status };
    }
    return {
      outcome: "listed",
      counts: { agentCount: result.outcome === "empty" ? 0 : result.recorded },
    };
  }

  private async findPeople(sourceId: string): Promise<ListingOutcome<PeopleCounts>> {
    const organizationId = await this.findOrganizationId(sourceId, "people");
    if (organizationId === undefined) return SOURCE_GONE;
    const result = await this.deps.people.syncFromSource({
      organizationId,
      ingestionSourceId: sourceId,
      now: this.deps.now(),
    });
    if (result.outcome === "refused") {
      return { outcome: "refused", reason: result.refusal.reason, status: result.refusal.status };
    }
    return {
      outcome: "listed",
      counts:
        result.outcome === "empty"
          ? { directoryPersonCount: 0, withheldPersonCount: 0 }
          : { directoryPersonCount: result.named, withheldPersonCount: result.withheld },
    };
  }
}
