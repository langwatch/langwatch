/**
 * Settings, Checkup (specs/self-hosting/checkup/checkup.feature). Reading is any member's,
 * running a paid check or changing the report an organization manager's; the details and
 * the install-wide report an organization manager's or an install admin's.
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
    .withPermission("organization:manage")
    .handle(({ app, input }, operator) => app.setUsageReportSwitches({ ...input, operator }))
    .build();
