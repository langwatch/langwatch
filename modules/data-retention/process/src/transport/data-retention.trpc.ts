/**
 * The server half of `dataRetention.*`: a permission and a handler per procedure the contract
 * already named. A scope write asks the permission its target needs, on the target, at the door.
 * Spec: modules/data-retention/specs/data-retention-scope-writes.feature
 */

import { permissionBy } from "@langwatch/api/access";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DataRetentionApi, dataRetentionTrpc } from "@langwatch/data-retention-contract";

/** Main's rule: a project member edits their own project, not the organization's default. */
const WRITE_ON_SCOPE = permissionBy({
  field: "scope.scopeType",
  map: {
    ORGANIZATION: {
      permission: "organization:manage",
      tier: "organization",
      field: "scope.scopeId",
    },
    TEAM: { permission: "team:manage", tier: "team", field: "scope.scopeId" },
    PROJECT: { permission: "project:update", tier: "project", field: "scope.scopeId" },
  },
});

export const dataRetentionTrpcTransport: TrpcRouterDeclaration<
  DataRetentionApi,
  typeof dataRetentionTrpc
> = defineTrpcRouter(DataRetentionApi, dataRetentionTrpc)
  .procedure("getRules")
  .withPermission("project:view")
  .handle(async ({ app, input, actor }) =>
    app.getPolicySnapshot({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("setForScope")
  .withPermission(WRITE_ON_SCOPE)
  .handle(async ({ app, input, actor }) =>
    app.changeScopeRetention({
      organizationId: input.organizationId,
      scope: input.scope,
      category: input.category,
      retentionDays: input.retentionDays,
      userId: actor.id,
    }),
  )

  .procedure("previewScopeRemoval")
  .withPermission(WRITE_ON_SCOPE)
  .handle(async ({ app, input, actor }) =>
    app.previewScopeRemoval({
      organizationId: input.organizationId,
      scope: input.scope,
      userId: actor.id,
    }),
  )

  .procedure("removeForScope")
  .withPermission(WRITE_ON_SCOPE)
  .handle(async ({ app, input, actor }) => {
    await app.removeForScope({
      organizationId: input.organizationId,
      scope: input.scope,
      category: input.category,
      userId: actor.id,
    });
  })

  .procedure("triggerRetroactiveUpdate")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) =>
    app.applyRetentionToExistingData({
      projectId: input.projectId,
      category: input.category,
      userId: actor.id,
    }),
  )

  .procedure("getMutationProgress")
  .withPermission("traces:view")
  .handle(async ({ app, input }) =>
    app.getRetroactiveMutationProgress({ projectId: input.projectId }),
  )

  .procedure("killMutation")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) => {
    await app.killRetroactiveMutation({
      projectId: input.projectId,
      mutationId: input.mutationId,
      userId: actor.id,
    });
  })

  .procedure("getScopeStorageUsage")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.getScopeStorageUsage({
      projectId: input.projectId,
      scope: input.scope,
      userId: actor.id,
    }),
  )
  .build();
