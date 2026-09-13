// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the Agents screen: the organization's agents, from both
 * origins, as one list.
 *
 * Organization-scoped rather than project-scoped, which is the point. The
 * platform's other agents read (`agents.getAll`) is scoped to one project and
 * gated on `evaluations:view`; reading one project through it and labelling
 * the result as the organization's is the lie this page refused to tell for as
 * long as it fetched nothing.
 *
 * The two reads are on `governance:view`; the one write is on
 * `governance:manage`, matching `governancePeople.runMatch`, because asking a
 * provider to enumerate a tenant is an administrative act and not a read.
 *
 * `requestListing` RETURNS BEFORE ANY PROVIDER HAS ANSWERED, and its name says
 * so. It records a request; the pipeline calls the provider later. Anything
 * here that claimed to report what was found would be inventing it.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

/**
 * The pipeline name comes from the pipeline's leaf constants module rather
 * than being retyped here, so a rename is a compile error rather than an
 * {@link AgentListingUnavailableError} on somebody's first press.
 *
 * The leaf is deliberate. Importing the same name from `pipeline.ts` would
 * pull the commands, the projection and the whole process manager into every
 * request-serving process, including ones running with event sourcing off,
 * which is the cost {@link agentListingDispatcher} exists to avoid paying.
 */
import { INGESTION_PULL_PROCESSING_PIPELINE_NAME } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import { AgentListingUnavailableError } from "@ee/governance/services/governanceAgentSync.errors";
import {
  type AgentListingDispatcher,
  GovernanceAgentSyncService,
} from "@ee/governance/services/governanceAgentSync.service";
import { GovernanceAgentsScreenService } from "@ee/governance/services/governanceAgentsScreen.service";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";

/**
 * The one edge that needs a running pipeline.
 *
 * Resolved per call rather than at module load: the router is imported by
 * every request-serving process, including ones where event sourcing is off,
 * and a missing pipeline must be a named refusal on the press rather than a
 * crash at import.
 */
function agentListingDispatcher(): AgentListingDispatcher {
  const eventSourcing = getApp().eventSourcing;
  if (!eventSourcing?.isEnabled) {
    throw new AgentListingUnavailableError("event_sourcing_disabled");
  }
  let pipeline: ReturnType<typeof eventSourcing.getPipeline>;
  try {
    pipeline = eventSourcing.getPipeline(
      INGESTION_PULL_PROCESSING_PIPELINE_NAME,
    );
  } catch {
    // The thrown message names every pipeline the process registered, which is
    // deployment shape rather than anything a reader can act on.
    throw new AgentListingUnavailableError("event_sourcing_disabled");
  }
  return (command) => pipeline.commands.requestAgentsListing.send(command);
}

export const governanceAgentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
      return await GovernanceAgentsScreenService.create(ctx.prisma).listAgents({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Which providers this organization has that can be asked about agents, and
   * how the last ask of each one ended.
   *
   * On the view grant, not the manage one. A reader who cannot press the
   * button still needs the empty table to say which providers it is speaking
   * for, and gating the sentence on the grant that draws the button would take
   * that away from exactly the reader least able to work it out.
   *
   * The outcome rides on this read rather than on a procedure of its own
   * because it is the same per-source fact about the same set: a second
   * procedure would let the sentence naming the providers and the sentence
   * explaining them disagree about which providers exist.
   *
   * WHAT DOES NOT COME BACK. No HTTP status and no provider error body. The
   * service narrows a refusal to what a person can act on before it ever
   * reaches this file — see `agentsListingOutcome` — which is why this router,
   * a customer-facing tree the privacy guard scans, names none of those
   * columns.
   */
  syncSources: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:view")
    .query(async ({ ctx, input }) => {
      return await GovernanceAgentSyncService.forReads(
        ctx.prisma,
      ).listableSourcesWithLastListing({
        organizationId: input.organizationId,
      });
    }),

  requestListing: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("governance:manage")
    .mutation(async ({ ctx, input }) => {
      return await GovernanceAgentSyncService.create({
        prisma: ctx.prisma,
        dispatch: agentListingDispatcher(),
      }).requestListing({ organizationId: input.organizationId });
    }),
});
