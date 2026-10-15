// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `scimOversight.*`, the back office's directory-sync oversight (ADR-122): the door asks
 * ops:manage at the platform tier, never an org permission; every refusal is a not-found.
 * enterprise/modules/scim/specs/scim-reconciliation-surfaces.feature
 */
import {
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { ScimApi, scimOversightTrpc, type ScimOperator } from "@langwatch/enterprise-scim-contract";

const OPERATOR_SCOPE = { at: "platform", refusal: "hidden" } as const;

/** The impersonator where there is one: debugging a customer stays operator work. */
function operatorOf(actor: TrpcHandlerActor): ScimOperator {
  if (actor.type === "user" && actor.impersonatorId !== undefined) {
    return { id: actor.id, impersonatorId: actor.impersonatorId };
  }

  return { id: actor.id };
}

export const scimOversightTrpcTransport: TrpcRouterDeclaration<ScimApi, typeof scimOversightTrpc> =
  defineTrpcRouter(ScimApi, scimOversightTrpc)
    .procedure("getAll")
    .withPermission("ops:manage", OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.listOversightSyncs(input, operatorOf(actor)))

    .procedure("getById")
    .withPermission("ops:manage", OPERATOR_SCOPE)
    .handle(
      async ({ app, input, actor }) =>
        (await app.findOversightSync(input, operatorOf(actor)))[0] ?? null,
    )

    .procedure("directoryIdentities")
    .withPermission("ops:manage", OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.findDirectoryIdentities(input, operatorOf(actor)))

    .procedure("redriveRetiredApply")
    .withPermission("ops:manage", OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.redriveRetiredApply(input, operatorOf(actor)))
    .build();
