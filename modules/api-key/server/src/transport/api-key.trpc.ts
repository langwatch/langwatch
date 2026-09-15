/**
 * The server half of `apiKey.*`: a written access declaration and a handler
 * per procedure the contract already named. Names, kinds and schemas are not
 * repeated here.
 */

// No procedure declares a permission: an `apiKey:*` permission does not exist,
// because a personal key belongs to its owner. The application proves
// organization membership before it reads anything, and asks `isOrgAdmin` on
// the admin-only paths — so every procedure states the opt-out WITH the
// organization id explicitly allowed, which is what keeps the declaration
// sweep honest.

import { ApiKeyApi, apiKeyTrpc } from "@langwatch/api-key-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";

/**
 * One shared reason: nothing here is gated on a permission, because a personal
 * key belongs to its owner and the application proves that itself.
 */
const OWN_KEYS_REASON =
  "personal API keys are the caller's own; the application proves organization membership and ownership itself";

export const apiKeyTrpcTransport = defineTrpcRouter(ApiKeyApi, apiKeyTrpc)
  .procedure("myBindings")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "listing caller's own role bindings" },
  })
  .handle(({ app, input, actor }) => app.listCallerBindings(input, { id: actor.id }))

  .procedure("nameById")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "naming an API key the caller can already see" },
  })
  .handle(({ app, input, actor }) => app.findKeyName(input, { id: actor.id }))

  .procedure("list")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "listing API keys" },
  })
  .handle(({ app, input, actor }) => app.listKeys(input, { id: actor.id }))

  .procedure("create")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "creating API key for user's own org" },
  })
  // Mints a key and hands back its plaintext token — once, here, and nowhere
  // else. Only the key's identity rides beside it, which is also all the
  // declared output admits.
  .handle(async ({ app, input, actor }) => {
    const { token, apiKey } = await app.createKey(input, { id: actor.id });

    return {
      token,
      apiKey: { id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt },
    };
  })

  .procedure("update")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "updating API key" },
  })
  .handle(async ({ app, input, actor }) => {
    const updated = await app.updateKey(input, { id: actor.id });

    return { id: updated.id, name: updated.name, permissionMode: updated.permissionMode };
  })

  .procedure("revoke")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "revoking API key" },
  })
  .handle(async ({ app, input, actor }) => {
    await app.revokeKey(input, { id: actor.id });

    return { success: true };
  })

  .procedure("orgProjects")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "listing org projects for permission picker" },
  })
  .handle(({ app, input, actor }) => app.listOrganizationProjects(input, { id: actor.id }))

  .procedure("orgTeams")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "listing org teams for scope picker" },
  })
  .handle(({ app, input, actor }) => app.listOrganizationTeams(input, { id: actor.id }))

  .procedure("orgMembers")
  .noPermission({
    reason: OWN_KEYS_REASON,
    allow: { organizationId: "listing org members for key assignment" },
  })
  .handle(({ app, input, actor }) => app.listOrganizationMembers(input, { id: actor.id }))

  .build();
