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

import type { PrismaClient } from "~/generated/prisma/client";

import { IngestionSourceService } from "./activity-monitor/ingestionSource.service";
import { AgentListingUnavailableError } from "./governanceAgentSync.errors";
import { resolveGovProjectId } from "./govProject";
import {
  type AgentListingRequestCommand,
  agentListingRequests,
  listableAgentSources,
} from "./logic/agentListingRequest";

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

export interface AgentListingRequestResult {
  /** How many sources were asked. Never how many answered. */
  requested: number;
  /** Names the ask went to, in the order the screen would say them. */
  sources: AgentSyncSource[];
}

export class GovernanceAgentSyncService {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatch: AgentListingDispatcher,
    private readonly newRequestId: () => string,
  ) {}

  static create(
    prisma: PrismaClient,
    dispatch: AgentListingDispatcher,
    newRequestId: () => string = () => nanoid(),
  ): GovernanceAgentSyncService {
    return new GovernanceAgentSyncService(prisma, dispatch, newRequestId);
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
    return new GovernanceAgentSyncService(
      prisma,
      () => {
        throw new Error(
          "GovernanceAgentSyncService.forReads cannot dispatch a listing",
        );
      },
      () => nanoid(),
    );
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
    const sources = await IngestionSourceService.create(this.prisma).list(
      organizationId,
    );
    return listableAgentSources(sources).map((source) => ({
      id: source.id,
      name: source.name,
      sourceType: source.sourceType,
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
    const sources = await this.listableSources({ organizationId });
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
