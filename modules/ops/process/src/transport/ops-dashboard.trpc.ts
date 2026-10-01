/**
 * The server half of the operator dashboard and scheduler procedures.
 * Platform-tier: the platform-operator grant decides, not an
 * RBAC permission. `getScope` answers rather than refuses, so the menu can poll it.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsDashboardTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_PROBE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsDashboardTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsDashboardTrpc> =
  defineTrpcRouter(OpsApi, opsDashboardTrpc)
    .procedure("getScope")
    .withFacts(opsOperatorFact)
    .noPermission(OPS_PROBE)
    .handle(async ({ app }, operator) => ({ scope: await app.operatorScope(operator) }))

    .procedure("getDashboardSnapshot")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.findDashboardData();
    })

    .procedure("getSignUpHealth")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.getSignUpHealth(input);
    })

    .procedure("getBadgeCounts")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.badgeCounts();
    })

    .procedure("dashboardStream")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, signal }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.streamDashboard({ signal });
    })

    .procedure("listParkedGroups")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.listParkedQueueGroups(input);
    })

    .procedure("listQueues")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.listQueues();
    })

    .procedure("listScheduledJobs")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.listScheduledJobs({ limit: input.limit });
    })

    .procedure("listPausedSchedules")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.listPausedSchedules({ limit: input.limit });
    })

    .procedure("listSchedulerActions")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_VIEW)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:view");

      return app.listSchedulerActions({ limit: input.limit });
    })

    .procedure("setScheduleActive")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app, input, actor }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      return app.setScheduleActive({
        scheduleId: input.scheduleId,
        active: input.active,
        actorUserId: actor.id,
      });
    })

    .procedure("clearScheduleSlot")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app, input, actor }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      return app.clearStuckScheduleSlot({
        scheduleId: input.scheduleId,
        actorUserId: actor.id,
      });
    })

    .procedure("runScheduleNow")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app, input, actor }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      return app.runScheduleNow({
        scheduleId: input.scheduleId,
        actorUserId: actor.id,
      });
    })
    .build();
