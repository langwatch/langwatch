/**
 * The server half of `apiKey.*`: a written access declaration and a handler
 * per procedure the contract already named. Names, kinds and schemas are not
 * repeated here.
 */

// No procedure declares a permission: `apiKey:*` doesn't exist, because
// a personal key belongs to its owner. The app proves org membership
// first and asks `isOrgAdmin` on admin-only paths — every procedure states
// the opt-out WITH the organization id, keeping the declaration sweep honest.

import { ApiKeyApi, apiKeyTrpc } from "@langwatch/api-key-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";

/**
 * Nothing here is gated on a permission, because a personal
 * key belongs to its owner and the application proves that itself.
 */
const OWN_KEYS_REASON =
  "personal API keys are the caller's own; the application proves organization membership and ownership itself";
const KEY_ASSIGNMENT_REASON =
  "any member assigning a key needs the organization's projects, teams and members; the application refuses a non-member before reading";

export const apiKeyTrpcTransport: TrpcRouterDeclaration<ApiKeyApi, typeof apiKeyTrpc> =
  defineTrpcRouter(ApiKeyApi, apiKeyTrpc)
    .procedure("myBindings")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.listCallerBindings(input, { id: actor.id }))

    .procedure("nameById")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.findKeyName(input, { id: actor.id }))

    .procedure("list")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.listKeys(input, { id: actor.id }))

    .procedure("create")
    .mintsCredential("organization:view")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    // Mints a key and hands back its plaintext token — once, here, and nowhere
    // else. Only the key's identity rides beside it, which is also all the
    // declared output admits.
    .handle(async ({ app, input, actor }) => {
      const { token, apiKey } = await app.createKey(input, actor);

      return {
        token,
        apiKey: { id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt },
      };
    })

    .procedure("update")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(async ({ app, input, actor }) => {
      const updated = await app.updateKey(input, { id: actor.id });

      return { id: updated.id, name: updated.name, permissionMode: updated.permissionMode };
    })

    .procedure("revoke")
    .noPermission({
      reason: OWN_KEYS_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(async ({ app, input, actor }) => {
      await app.revokeKey(input, { id: actor.id });

      return { success: true };
    })

    .procedure("orgProjects")
    .noPermission({
      reason: KEY_ASSIGNMENT_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.listOrganizationProjects(input, { id: actor.id }))

    .procedure("orgTeams")
    .noPermission({
      reason: KEY_ASSIGNMENT_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.listOrganizationTeams(input, { id: actor.id }))

    .procedure("orgMembers")
    .noPermission({
      reason: KEY_ASSIGNMENT_REASON,
      allow: {
        organizationId: "the application refuses a caller who is not a member of this organization",
      },
    })
    .handle(({ app, input, actor }) => app.listOrganizationMembers(input, { id: actor.id }))

    .build();
