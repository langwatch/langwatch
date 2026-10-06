/**
 * The server half of the operator dashboard and scheduler procedures.
 * Platform-tier: the door asks the platform-operator grant. `getScope` answers rather than
 * refuses, so the menu can poll it.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsDashboardTrpc } from "@langwatch/ops-contract";

import { OPS_PROBE, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsDashboardTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsDashboardTrpc> =
  defineTrpcRouter(OpsApi, opsDashboardTrpc)
    .procedure("getScope")
    .withFacts(opsOperatorFact)
    .noPermission(OPS_PROBE)
    .handle(async ({ app }, operator) => ({ scope: await app.operatorScope(operator) }))

    .procedure("getDashboardSnapshot")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.findDashboardData())

    .procedure("getSignUpHealth")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getSignUpHealth(input))

    .procedure("getBadgeCounts")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.badgeCounts())

    .procedure("dashboardStream")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, signal }) => app.streamDashboard({ signal }))

    .procedure("listParkedGroups")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listParkedQueueGroups(input))

    .procedure("listQueues")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listQueues())

    .procedure("listScheduledJobs")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listScheduledJobs({ limit: input.limit }))

    .procedure("listPausedSchedules")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listPausedSchedules({ limit: input.limit }))

    .procedure("listSchedulerActions")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listSchedulerActions({ limit: input.limit }))

    .procedure("setScheduleActive")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.setScheduleActive({
        scheduleId: input.scheduleId,
        active: input.active,
        actorUserId: actor.id,
      }),
    )

    .procedure("clearScheduleSlot")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.clearStuckScheduleSlot({
        scheduleId: input.scheduleId,
        actorUserId: actor.id,
      }),
    )

    .procedure("runScheduleNow")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.runScheduleNow({
        scheduleId: input.scheduleId,
        actorUserId: actor.id,
      }),
    )
    .build();
