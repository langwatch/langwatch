/**
 * The server half of the Upgrades pages' six reads. Each asks `ops:view` on the platform at the
 * door, so a non-operator never reaches the reader. Spec: modules/ops/specs/upgrades.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsUpgradeTrpc } from "@langwatch/ops-contract";

export const opsUpgradeTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsUpgradeTrpc> =
  defineTrpcRouter(OpsApi, opsUpgradeTrpc)
    .procedure("status")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getUpgradeStatus())

    .procedure("listReleases")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listUpgradeReleases())

    .procedure("listSteps")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listUpgradeSteps(input))

    .procedure("getStep")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpgradeStep({ id: input.id }))

    .procedure("listRuns")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listUpgradeRuns(input))

    .procedure("getRun")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpgradeRun({ id: input.id }))
    .build();
