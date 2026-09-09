/**
 * The server half of the event-log, replay and anomaly procedures.
 *
 * Platform-tier throughout: see `ops-operator.trpc.ts` for why the gate is the
 * application's rather than the door's.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsEventLogTrpc } from "@langwatch/ops-contract";
import { TRPCError } from "@trpc/server";

import { OPS_MANAGE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

/** What a caller reads when a replay could not be started for any other reason. */
const REPLAY_NOT_STARTED = "Replay could not be started";

export const opsEventLogTrpcTransport = defineTrpcRouter(OpsApi, opsEventLogTrpc)
  .procedure("searchAggregates")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.searchAggregates({
      query: input.query,
      tenantIds: input.tenantId ? [input.tenantId] : [],
      sinceMs: input.sinceMs,
    });
  })

  .procedure("getEventLogSearchWindow")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getEventLogSearchWindow();
  })

  .procedure("loadAggregateEvents")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getAggregateEvents(input);
  })

  .procedure("computeProjectionState")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.computeProjectionState(input);
  })

  .procedure("discoverAggregates")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.discoverAggregates({
      projectionNames: input.projectionNames,
      since: input.since,
      tenantIds: input.tenantIds ?? [],
    });
  })

  .procedure("searchTenants")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.searchProjects({ query: input.query });
  })

  .procedure("dryRunReplay")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return {
      status: "coming_soon" as const,
      message: "Dry run is not yet implemented. Full replay will process all aggregates.",
      projectionNames: input.projectionNames,
      sampleSize: input.sampleSize,
    };
  })

  .procedure("getReplayHistory")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getHistory();
  })

  .procedure("getReplayRun")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.tryFindHistoryEntry({ runId: input.runId });
  })

  .procedure("startReplay")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    try {
      return await app.startReplay({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
        aggregateIds: input.aggregateIds,
        fullRebuild: input.fullRebuild,
        description: input.description,
        userName: operator?.name ?? operator?.email ?? "unknown",
      });
    } catch (err) {
      // Left as a raw TRPCError deliberately, and it is the one refusal on
      // this surface that is. The branch answers CONFLICT for EVERY failure,
      // including infrastructure ones: "already running" is a nameable cause a
      // caller can act on, and everything else is not. Splitting it needs an
      // error code this module cannot add, so it is reported rather than
      // taken here.
      const rawMessage = err instanceof Error ? err.message : String(err);

      throw new TRPCError({
        code: "CONFLICT",
        message: rawMessage.includes("already running") ? rawMessage : REPLAY_NOT_STARTED,
      });
    }
  })

  .procedure("getReplayStatus")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getStatus();
  })

  .procedure("cancelReplay")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.cancelReplay();
  })

  .procedure("listAnomalies")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(async ({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return { anomalies: await app.listAnomalies() };
  })

  .procedure("dismissAnomaly")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return { dismissed: await app.dismissAnomaly(input) };
  })
  .build();
