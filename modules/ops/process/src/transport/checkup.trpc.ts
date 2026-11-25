/**
 * Settings, Checkup (specs/self-hosting/checkup/checkup.feature). Any member reads; an org
 * manager runs paid checks and reads details; only ops:manage at the platform changes the
 * install's report switches and reads or changes the automatic upgrade diagnostics switch.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { checkupTrpc, OpsApi } from "@langwatch/ops-contract";

import { opsOperatorContext } from "#transport/ops-operator.trpc";

export const checkupTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof checkupTrpc> =
  defineTrpcRouter(OpsApi, checkupTrpc)
    .procedure("status")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("organization:view")
    .handle(({ app, input }, operator) => app.getCheckup({ ...input, operator }))

    .procedure("run")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("organization:manage")
    .handle(({ app, input, actor }, operator) =>
      app.runCheckup({ ...input, operator, requestedBy: actor.id }),
    )

    .procedure("usageReport")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("organization:view")
    .handle(({ app, input }, operator) => app.getUsageReport({ ...input, operator }))

    .procedure("setUsageReportSwitches")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) => app.setUsageReportSwitches({ ...input, operator }))

    .procedure("upgradeDiagnosticsAutoSend")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) => app.getUpgradeDiagnosticsAutoSend({ ...input, operator }))

    .procedure("setUpgradeDiagnosticsAutoSend")
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) => app.setUpgradeDiagnosticsAutoSend({ ...input, operator }))
    .build();
