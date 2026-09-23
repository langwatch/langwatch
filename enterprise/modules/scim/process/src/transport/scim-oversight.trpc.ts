// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `scimOversight.*`: the back office's directory-sync
 * oversight (ADR-122). Gated on the ADMIN_EMAILS staff list rather than an
 * RBAC permission — `ops:*` must not widen who may re-drive a customer's
 * deprovision. specs/identity/scim-reconciliation-surfaces.feature
 */
import { defineTrpcRouter, type TrpcHandlerActor } from "@langwatch/api/trpc";
import { ScimApi, scimOversightTrpc, type ScimOperator } from "@langwatch/enterprise-scim-contract";

const STAFF_LIST_REASON =
  "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design";

/** The impersonator where there is one: debugging a customer stays operator work. */
function operatorOf(actor: TrpcHandlerActor): ScimOperator {
  if (actor.type === "user" && actor.impersonatorId !== undefined) {
    return { id: actor.id, impersonatorId: actor.impersonatorId };
  }

  return { id: actor.id };
}

export const scimOversightTrpcTransport = defineTrpcRouter(ScimApi, scimOversightTrpc)
  .procedure("getAll")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(({ app, input, actor }) => app.listOversightSyncs(input, operatorOf(actor)))

  .procedure("getById")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(
    async ({ app, input, actor }) =>
      (await app.findOversightSync(input, operatorOf(actor)))[0] ?? null,
  )

  .procedure("directoryIdentities")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(({ app, input, actor }) => app.findDirectoryIdentities(input, operatorOf(actor)))

  .procedure("redriveRetiredApply")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(({ app, input, actor }) => app.redriveRetiredApply(input, operatorOf(actor)))
  .build();
