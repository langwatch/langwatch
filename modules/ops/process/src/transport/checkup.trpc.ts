/**
 * Settings, Checkup (specs/self-hosting/checkup/checkup.feature). Reading is
 * any member's; running a check that costs egress or money, and changing what
 * the install reports, are organization management rights.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { checkupTrpc, OpsApi } from "@langwatch/ops-contract";

export const checkupTrpcTransport = defineTrpcRouter(OpsApi, checkupTrpc)
  .procedure("status")
  .withPermission("organization:view")
  .handle(({ app, input }) => app.getCheckup(input))

  .procedure("run")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) => app.runCheckup({ ...input, requestedBy: actor.id }))

  .procedure("usageReport")
  .withPermission("organization:view")
  .handle(({ app, input }) => app.getUsageReport(input))

  .procedure("setUsageReportSwitches")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.setUsageReportSwitches(input))

  .procedure("startupNotice")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getStartupNotice(input))

  .procedure("dismissStartupNotice")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.dismissStartupNotice(input))
  .build();
