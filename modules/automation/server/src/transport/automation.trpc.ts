/**
 * The server half of `automation.*`: the permission each procedure is answered
 * behind, and one call into the application. Every rule a door used to carry is
 * the application's now, so the REST family cannot enforce a different one.
 * Spec: ADR-026, ADR-031, ADR-040, ADR-041, ADR-043, ADR-044.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { AutomationApi, automationTrpc } from "@langwatch/automation-contract";
import { z } from "zod";

/**
 * The address a test fire is delivered to, as the PROCESS resolves it for the
 * signed-in caller. A fact rather than part of the actor: ADR-031 says a test
 * fire is not an open relay, so the recipient is the requester's own address
 * and nothing a client sends can stand in for it.
 */
export const automationCallerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());

export const automationTrpcTransport = defineTrpcRouter(AutomationApi, automationTrpc)
  // Creating asks for `:create`; `:manage` still implies it, so no existing
  // caller changes and a viewer is declined as before.
  .procedure("create")
  .withPermission("triggers:create")
  .handle(({ app, input, actor }) => app.createAutomation(input, { id: actor.id }))

  /**
   * Removal is one operation on the application: the soft delete, the
   * retirement of any scheduled-report entry, and the dispatch-cache
   * invalidation. Doing it in three calls here left the REST family free to do
   * two of the three, which is exactly what it did.
   */
  .procedure("deleteById")
  .withPermission("triggers:delete")
  .handle(async ({ app, input }) => {
    await app.delete({ triggerId: input.triggerId, projectId: input.projectId });

    return { success: true };
  })

  .procedure("getTriggers")
  .withPermission("triggers:view")
  .handle(({ app, input }) => app.listAutomations({ projectId: input.projectId }))

  .procedure("getDailyCap")
  .withPermission("triggers:view")
  .handle(async ({ app, input }) => ({
    cap: await app.resolvePersistDailyCap(input.projectId),
  }))

  .procedure("getDailyCapStatus")
  .withPermission("triggers:view")
  .handle(({ app, input }) => app.readDailyCapStatus({ projectId: input.projectId }))

  .procedure("getTriggerStats")
  .withPermission("triggers:view")
  .handle(({ app, input }) => app.getFireStats({ projectId: input.projectId }))

  .procedure("getRecentFires")
  .withPermission("triggers:view")
  .handle(({ app, input }) =>
    app.getRecentFires({
      projectId: input.projectId,
      triggerId: input.triggerId,
      limit: input.limit,
    }),
  )

  .procedure("getWebhookDeliveries")
  .withPermission("triggers:view")
  .handle(({ app, input }) =>
    app.getRecentWebhookDeliveries({
      projectId: input.projectId,
      triggerId: input.triggerId,
      limit: input.limit,
    }),
  )

  .procedure("getRecentActivity")
  .withPermission("triggers:view")
  .handle(({ app, input }) =>
    app.getRecentFires({ projectId: input.projectId, limit: input.limit }),
  )

  .procedure("getReportSchedules")
  .withPermission("triggers:view")
  .handle(({ app, input }) => app.getReportSchedules({ projectId: input.projectId }))

  .procedure("toggleTrigger")
  .withPermission("triggers:update")
  .handle(({ app, input }) => app.setAutomationActive(input))

  .procedure("getTriggerById")
  .withPermission("triggers:view")
  .handle(({ app, input }) =>
    app.findRedactedById({ triggerId: input.triggerId, projectId: input.projectId }),
  )

  .procedure("listSlackChannels")
  .withPermission("triggers:update")
  .handle(({ app, input }) => app.listSlackChannels(input))

  .procedure("updateTriggerFilters")
  .withPermission("triggers:update")
  .handle(({ app, input }) => app.replaceAutomationFilters(input))

  .procedure("testFireTemplate")
  .withFacts(automationCallerEmailFact)
  .withPermission("triggers:update")
  .handle(({ app, input, actor }, email) => app.sendTestFire(input, { id: actor.id, email }))

  .procedure("upsert")
  .withPermission("triggers:update")
  .handle(({ app, input, actor }) => app.saveAutomation(input, { id: actor.id }))
  .build();
