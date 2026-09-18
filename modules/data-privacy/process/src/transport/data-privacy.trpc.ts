/**
 * The server half of `dataPrivacy.*`: a permission and a handler per
 * procedure. Writes are authorized on the TARGET scope's own tier, anchored
 * to the acting project's organization — no member can push a rule up.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DataPrivacyApi, dataPrivacyTrpc } from "@langwatch/data-privacy-contract";

const SCOPE_TARGETED_PERMISSIONS = [
  "organization:manage",
  "team:manage",
  "project:update",
] as const;

function scopeTargeted(act: string): {
  reason: string;
  permissions: typeof SCOPE_TARGETED_PERMISSIONS;
  enforces: { projectId: string };
} {
  return {
    reason:
      "The authorized target is the organization, department, team or project named by `scope`, " +
      "which the app anchors to this project's organization first — the `projectId` this input " +
      "also carries is not acted on.",
    permissions: SCOPE_TARGETED_PERMISSIONS,
    enforces: {
      projectId: `assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteScope authorizes the ${act}`,
    },
  };
}

export const dataPrivacyTrpcTransport = defineTrpcRouter(DataPrivacyApi, dataPrivacyTrpc)
  /**
   * `project:view`: reading the screen is a project read. The snapshot filters
   * the rules and the writable scopes it returns by what the caller may
   * actually see, so a wider gate here would not widen the answer.
   */
  .procedure("getSnapshot")
  .withPermission("project:view")
  .handle(async ({ app, input, actor }) =>
    app.getSnapshot({ projectId: input.projectId, userId: actor.id }),
  )

  .procedure("setForScope")
  .serviceAuthorized(scopeTargeted("write"))
  .handle(async ({ app, input, actor }) =>
    app.setScopeRule({
      projectId: input.projectId,
      scope: input.scope,
      personalOnly: input.personalOnly,
      config: input.config,
      userId: actor.id,
    }),
  )

  .procedure("removeForScope")
  .serviceAuthorized(scopeTargeted("removal"))
  .handle(async ({ app, input, actor }) => {
    await app.removeScopeRule({
      projectId: input.projectId,
      scope: input.scope,
      personalOnly: input.personalOnly,
      userId: actor.id,
    });
  })
  .build();
