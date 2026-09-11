// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Asking the organization's providers what agents they have, now.
 *
 * ASYNCHRONOUS BY DESIGN, and the whole shape of this service follows from it.
 * A request is dispatched and the call returns. The pipeline's outbox leases
 * it, an effect handler calls the provider, and the outcome lands in the log
 * later. There is nothing here to await and nothing to report about what the
 * provider said, so this returns what was ASKED and never what was found.
 *
 * A second ask arriving while one is still running is dropped by the process
 * manager rather than queued (`currentAgentsListing` in the pull process
 * state): pressing a sync button twice means "did that work", not "ask twice".
 * That drop happens after this returns and is invisible from here, which is
 * why the screen's own wording has to carry it.
 *
 * The dispatcher is injected rather than reached for. It is the one edge of
 * this service that needs a running pipeline, and holding it as an argument is
 * what lets the listing decision be tested without one.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";

import type { IngestionSource, PrismaClient } from "~/generated/prisma/client";

import { IngestionSourceService } from "./activity-monitor/ingestionSource.service";
import { AgentListingUnavailableError } from "./governanceAgentSync.errors";
import { resolveGovProjectId } from "./govProject";
import {
  type AgentListingRequestCommand,
  agentListingRequests,
  listableAgentSources,
} from "./logic/agentListingRequest";
import { schedulerWillPull } from "./logic/schedulerWillPull";
import {
  type AgentsListingOutcome,
  type AgentsListingSummary,
  agentsListingOutcome,
} from "./pullers/agentsListingOutcome";
import { PrismaIngestionPullRunProjectionRepository } from "./pullers/repositories/ingestion-pull-run-projection.prisma.repository";

const logger = createLogger("langwatch:governance:agent-sync");

/** What one press dispatches, per source. Returns once the ask is recorded. */
export type AgentListingDispatcher = (
  command: AgentListingRequestCommand,
) => Promise<unknown>;

/** A source the screen may name, and may ask. */
export interface AgentSyncSource {
  id: string;
  name: string;
  sourceType: string;
}

/** The row, narrowed to what the screen names a provider by. */
const toSyncSource = (source: IngestionSource): AgentSyncSource => ({
  id: source.id,
  name: source.name,
  sourceType: source.sourceType,
});

/**
 * A source the screen may name, plus how the last ask of it ended.
 *
 * A separate type from {@link AgentSyncSource} rather than an optional field
 * on it, because the two are read by callers with different needs and an
 * optional `lastListing` would be indistinguishable at the call site from a
 * source that has never been listed. {@link AgentListingRequestResult} names
 * what a press asked, which has no outcome yet by definition.
 */
export interface AgentSyncSourceListing extends AgentSyncSource {
  /** `null` when no listing has been recorded for this source. */
  lastListing: AgentsListingOutcome | null;
}

export interface AgentListingRequestResult {
  /** How many sources were asked. Never how many answered. */
  requested: number;
  /** Names the ask went to, in the order the screen would say them. */
  sources: AgentSyncSource[];
}

/**
 * What this service needs to do its job, named rather than ordered.
 *
 * `prisma` and `dispatch` are both edges of the system and a positional pair
 * of them is two chances to swap the arguments silently; `newRequestId` is a
 * seam for tests, which is exactly the argument a call site should never have
 * to count places to reach. Every sibling factory in this directory takes its
 * dependencies this way.
 */
export interface GovernanceAgentSyncDeps {
  prisma: PrismaClient;
  dispatch: AgentListingDispatcher;
  /** Defaulted to a nanoid. Named so a test can pin it without positioning. */
  newRequestId?: () => string;
}

export class GovernanceAgentSyncService {
  private readonly prisma: PrismaClient;
  private readonly dispatch: AgentListingDispatcher;
  private readonly newRequestId: () => string;

  private constructor({
    prisma,
    dispatch,
    newRequestId = () => nanoid(),
  }: GovernanceAgentSyncDeps) {
    this.prisma = prisma;
    this.dispatch = dispatch;
    this.newRequestId = newRequestId;
  }

  static create(deps: GovernanceAgentSyncDeps): GovernanceAgentSyncService {
    return new GovernanceAgentSyncService(deps);
  }

  /**
   * For callers that only read which sources exist.
   *
   * A separate door rather than an optional dispatcher, so a read cannot fail
   * on a deployment where listings cannot run: composing the real dispatcher
   * would make "which providers do I have" depend on the pipeline that answers
   * a different question. The stand-in raises rather than returning, because a
   * read path reaching {@link requestListing} is a wiring mistake and silently
   * dispatching nothing would hide it.
   */
  static forReads(prisma: PrismaClient): GovernanceAgentSyncService {
    return new GovernanceAgentSyncService({
      prisma,
      dispatch: () => {
        throw new Error(
          "GovernanceAgentSyncService.forReads cannot dispatch a listing",
        );
      },
    });
  }

  /**
   * The sources this organization has that can be asked about agents.
   *
   * A read, on the view grant, because the screen needs it whether or not the
   * reader may press anything: an empty table has to be able to say which
   * providers it is speaking for, and a reader without the manage grant is
   * owed that sentence too.
   */
  async listableSources({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentSyncSource[]> {
    return (await this.listableSourceRows({ organizationId })).map(
      toSyncSource,
    );
  }

  /**
   * The same sources, unprojected.
   *
   * {@link listableSources} narrows to the three columns the screen names a
   * provider by, and that projection is the screen's contract — but the
   * schedule state is not in it, and deciding whether a source is worth asking
   * needs the schedule state. So the narrowing happens once, at the edge,
   * rather than being undone by a second read.
   *
   * Private. Nothing outside this class should be choosing which projection of
   * "the listable sources" it wants; there is one set, and the two shapes of it
   * come from one query.
   */
  private async listableSourceRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IngestionSource[]> {
    const sources = await IngestionSourceService.create(this.prisma).list(
      organizationId,
    );
    return listableAgentSources(sources);
  }

  /**
   * The same sources, each carrying how the last ask of it ended.
   *
   * A DECORATOR over {@link listableSources}, never a second query that
   * decides the set for itself. Which providers can be asked about agents is
   * one question with one answer, and two reads of it are how the button ends
   * up asking a set the sentence beside it does not describe.
   *
   * WHY THE SCREEN NEEDS THIS AT ALL. An empty agents table has three
   * possible readings and the page cannot tell them apart without this:
   * nobody has asked yet, a provider answered and holds none, or a provider
   * refused to answer. The first two mean nothing is wrong; the third means
   * somebody has to go fix a credential. Showing one sentence for all three
   * was the defect.
   *
   * An organization with no governance project has never ingested anything,
   * so there is no run-status row to read and every source correctly reports
   * no listing. That is the same reading as a source whose row exists and
   * whose listing columns are null, which is why it needs no branch of its own
   * downstream.
   *
   * On the view grant like {@link listableSources}, because a reader who
   * cannot press the button is the one most in need of being told that the
   * emptiness in front of them is a refusal rather than an answer.
   */
  async listableSourcesWithLastListing({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentSyncSourceListing[]> {
    const sources = await this.listableSources({ organizationId });
    if (sources.length === 0) return [];

    const projectId = await resolveGovProjectId({
      prisma: this.prisma,
      organizationId,
    });
    const listings: Map<string, AgentsListingSummary> = projectId
      ? await new PrismaIngestionPullRunProjectionRepository(
          this.prisma,
        ).findAgentsListings({
          sourceIds: sources.map((source) => source.id),
          projectId,
        })
      : new Map();

    return sources.map((source) => ({
      ...source,
      lastListing: agentsListingOutcome(listings.get(source.id)),
    }));
  }

  /**
   * Ask every listable source, and return once the asks are recorded.
   *
   * Sources with no listing are skipped rather than asked and refused: the
   * refusal would be `not_configured`, which was knowable without spending a
   * lease on it.
   *
   * An organization with nothing to ask returns zero rather than raising. It
   * is not an error state — the reader has connected no provider that lists
   * agents — and the screen has a sentence for it that an exception would
   * replace with a red box.
   */
  async requestListing({
    organizationId,
    now = Date.now(),
  }: {
    organizationId: string;
    now?: number;
  }): Promise<AgentListingRequestResult> {
    // Asked, not merely listable. A source the scheduler will not pull —
    // no schedule set, or switched off — reaches a process that settles the
    // request with no intent and no slot, so the ask spends a lease to record
    // nothing while the press reports a number the reader waits on.
    //
    // Filtered HERE and not in `listableAgentSources`, because that set also
    // answers "which providers does this screen speak for". An organization
    // whose only Genie is unscheduled still has a Genie connected, and must
    // not be told it has connected nothing that lists agents.
    const sources = (await this.listableSourceRows({ organizationId }))
      .filter(schedulerWillPull)
      .map(toSyncSource);
    if (sources.length === 0) return { requested: 0, sources: [] };

    // The aggregate is tenanted to the hidden governance project, the same one
    // the scheduled pull writes under. Without it there is no stream to append
    // to, so the ask cannot be recorded at all.
    const tenantId = await resolveGovProjectId({
      prisma: this.prisma,
      organizationId,
    });
    if (!tenantId) {
      throw new AgentListingUnavailableError("no_governance_project");
    }

    const requestId = this.newRequestId();
    const commands = agentListingRequests({
      sources,
      tenantId,
      requestId,
      now,
    });

    // Sequential rather than concurrent. These are appends to distinct
    // aggregates so they cannot contend, but a press asks at most a handful of
    // sources and a failure part-way through is easier to read in the log when
    // the order is the order.
    for (const command of commands) {
      await this.dispatch(command);
    }

    logger.info(
      { organizationId, requestId, requested: commands.length },
      "Requested an agent listing from every listable source",
    );

    return { requested: commands.length, sources };
  }
}
