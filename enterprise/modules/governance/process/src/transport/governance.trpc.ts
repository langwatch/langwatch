// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governance.*`. The actor lookup collapses every refusal to
 * null, so a `governance:view` holder learns nothing about who exists elsewhere, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, governanceTrpc } from "@langwatch/enterprise-governance-contract";

export const governanceTrpcTransport = defineTrpcRouter(GovernanceRestApi, governanceTrpc)
  .procedure("resolveActorPersonalProject")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findActorWorkspace(input))

  .procedure("setupState")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.governanceSetupState(input))

  .procedure("ocsfExport")
  .withPermission("complianceExport:view")
  .handle(({ app, input, actor }) =>
    app.governanceOcsfExport(
      {
        organizationId: input.organizationId,
        sinceMs: input.sinceMs ?? 0,
        sinceEventId: input.sinceEventId,
        limit: input.limit,
      },
      actor,
    ),
  )

  .procedure("quarantineFillStats")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.governanceQuarantineFillStats(input))

  .procedure("recordWorkspaceView")
  .withPermission("governance:view")
  .handle(({ app, input, actor }) =>
    app.governanceRecordWorkspaceView({ ...input, actorUserId: actor.id }),
  )
  .build();
