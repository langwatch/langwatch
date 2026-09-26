/**
 * Settings, Checkup (specs/self-hosting/checkup/checkup.feature). Reading is any
 * member's, running a paid check or changing the report an organization manager's;
 * details and the install-wide report only an install admin's (checkup-audience.feature).
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { checkupTrpc, OpsApi } from "@langwatch/ops-contract";

import { opsOperatorFact } from "#transport/ops-operator.trpc";

export const checkupTrpcTransport = defineTrpcRouter(OpsApi, checkupTrpc)
  .procedure("status")
  .withFacts(opsOperatorFact)
  .withPermission("organization:view")
  .handle(({ app, input }, operator) => app.getCheckup({ ...input, operator }))

  .procedure("run")
  .withFacts(opsOperatorFact)
  .withPermission("organization:manage")
  .handle(({ app, input, actor }, operator) =>
    app.runCheckup({ ...input, operator, requestedBy: actor.id }),
  )

  .procedure("usageReport")
  .withFacts(opsOperatorFact)
  .withPermission("organization:view")
  .handle(({ app, input }, operator) => app.getUsageReport({ ...input, operator }))

  .procedure("setUsageReportSwitches")
  .withFacts(opsOperatorFact)
  .withPermission("organization:manage")
  .handle(({ app, input }, operator) => app.setUsageReportSwitches({ ...input, operator }))

  .procedure("startupNotice")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getStartupNotice(input))

  .procedure("dismissStartupNotice")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.dismissStartupNotice(input))
  .build();
