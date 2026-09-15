/**
 * The server half of the operator dashboard and scheduler procedures. The
 * surface is PLATFORM-TIER: the gate is not an RBAC permission resolved
 * against an id in the input - there is no id - but the deployment's own
 * operator allow-list, which the application owns and `app.admitOperator`
 * decides with. `getScope` answers rather than refuses, so the menu can poll it.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsDashboardTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_PROBE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsDashboardTrpcTransport = defineTrpcRouter(OpsApi, opsDashboardTrpc)
  .procedure("getScope")
  .withFacts(opsOperatorFact)
  .noPermission(OPS_PROBE)
  .handle(({ app }, operator) => ({ scope: app.operatorScope(operator) }))

  .procedure("getDashboardSnapshot")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.findDashboardData();
  })

  .procedure("getBadgeCounts")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.badgeCounts();
  })

  .procedure("dashboardStream")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, signal }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.streamDashboard({ signal });
  })

  .procedure("listParkedGroups")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listParkedQueueGroups(input);
  })

  .procedure("listQueues")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listQueues();
  })

  .procedure("listScheduledJobs")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listScheduledJobs({ limit: input.limit });
  })

  .procedure("listPausedSchedules")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listPausedSchedules({ limit: input.limit });
  })

  .procedure("listSchedulerActions")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listSchedulerActions({ limit: input.limit });
  })

  .procedure("setScheduleActive")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.setScheduleActive({
      scheduleId: input.scheduleId,
      active: input.active,
      actorUserId: actor.id,
    });
  })

  .procedure("clearScheduleSlot")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.clearStuckScheduleSlot({
      scheduleId: input.scheduleId,
      actorUserId: actor.id,
    });
  })

  .procedure("runScheduleNow")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.runScheduleNow({
      scheduleId: input.scheduleId,
      actorUserId: actor.id,
    });
  })
  .build();
