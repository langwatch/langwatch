/**
 * The server half of `dataRetention.*`: a permission and a handler per
 * procedure the contract already named. Three of them do not act on the project
 * their input carries — `enforces` records what gates it instead.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DataRetentionApi, dataRetentionTrpc } from "@langwatch/data-retention-contract";

const SCOPE_TARGETED_REASON =
  "The authorized target is the organization, team or project named by `scope`, which the app " +
  "resolves — the `projectId` this input also carries is not acted on.";

const SCOPE_TARGETED_PERMISSIONS = [
  "organization:manage",
  "team:manage",
  "project:update",
] as const;

function scopeTargeted(enforcesProjectId: string) {
  return {
    reason: SCOPE_TARGETED_REASON,
    permissions: SCOPE_TARGETED_PERMISSIONS,
    enforces: { projectId: enforcesProjectId },
  };
}

export const dataRetentionTrpcTransport = defineTrpcRouter(DataRetentionApi, dataRetentionTrpc)
  .procedure("getRules")
  .withPermission("project:view")
  .handle(async ({ app, input, actor }) =>
    app.getPolicySnapshot({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("setForScope")
  .serviceAuthorized(
    scopeTargeted(
      "not acted on — the authorized target is `scope`: the write permission and the plan gate both run against the scope's own organization",
    ),
  )
  .handle(async ({ app, input, actor }) =>
    app.changeScopeRetention({
      scope: input.scope,
      category: input.category,
      retentionDays: input.retentionDays,
      userId: actor.id,
    }),
  )

  .procedure("previewScopeRemoval")
  .serviceAuthorized(
    scopeTargeted(
      "not acted on — the authorized target is `scope`: the write permission gates the preview exactly like the removal it previews",
    ),
  )
  .handle(async ({ app, input, actor }) =>
    app.previewScopeRemoval({ scope: input.scope, userId: actor.id }),
  )

  .procedure("removeForScope")
  .serviceAuthorized(
    scopeTargeted(
      "not acted on — the authorized target is `scope`: the write permission and the plan gate both run against the scope's own organization",
    ),
  )
  .handle(async ({ app, input, actor }) => {
    await app.removeForScope({
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
