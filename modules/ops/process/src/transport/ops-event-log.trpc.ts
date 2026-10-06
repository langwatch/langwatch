/**
 * The server half of the event-log, replay and anomaly procedures.
 * Platform-tier throughout: the door asks `ops:view` or `ops:manage` of the
 * operator's platform grant.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsEventLogTrpc } from "@langwatch/ops-contract";

import { opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsEventLogTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsEventLogTrpc> =
  defineTrpcRouter(OpsApi, opsEventLogTrpc)
    .procedure("searchAggregates")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) =>
      app.searchAggregates({
        query: input.query,
        tenantIds: input.tenantId ? [input.tenantId] : [],
        sinceMs: input.sinceMs,
      }),
    )

    .procedure("getEventLogSearchWindow")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getEventLogSearchWindow())

    .procedure("loadAggregateEvents")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getAggregateEvents(input))

    .procedure("computeProjectionState")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.computeProjectionState(input))

    .procedure("discoverAggregates")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) =>
      app.discoverAggregates({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
      }),
    )

    .procedure("searchTenants")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.searchProjects({ query: input.query }))

    .procedure("dryRunReplay")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ input }) => {
      return {
        status: "coming_soon" as const,
        message: "Dry run is not yet implemented. Full replay will process all aggregates.",
        projectionNames: input.projectionNames,
        sampleSize: input.sampleSize,
      };
    })

    .procedure("getReplayHistory")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getHistory())

    .procedure("getReplayRun")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.findHistoryEntry({ runId: input.runId }))

    .procedure("startReplay")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) =>
      app.startReplay({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
        aggregateIds: input.aggregateIds,
        fullRebuild: input.fullRebuild,
        description: input.description,
        userName: operator?.name ?? operator?.email ?? "unknown",
        requestedByUserId: operator?.id,
      }),
    )

    .procedure("getReplayStatus")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getStatus())

    .procedure("cancelReplay")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app }) => app.cancelReplay())

    .procedure("listAnomalies")
    .withPermission("ops:view", { at: "platform" })
    .handle(async ({ app }) => {
      return { anomalies: await app.listAnomalies() };
    })

    .procedure("dismissAnomaly")
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input }) => {
      return { dismissed: await app.dismissAnomaly(input) };
    })
    .build();
