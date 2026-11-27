// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly digest's operator controls and each person's own opt-out. The operator door hides them from non-staff and refuses
 * staff lacking ops:manage, as Cloud admin's other writes; the cloud-ops capability is the app's.
 */
import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { DigestApi, digestTrpc } from "@langwatch/enterprise-digest-contract";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorContext = defineMiddlewareContext("opsOperator", opsOperatorSchema.nullable());

/** Cloud admin staff hold ops:view at the platform; anyone else is answered not-found. */
const STAFF = { at: "platform", hiddenWithout: "ops:view" } as const;

/** Why the preference pair asks for no permission. */
const OWN_PREFERENCE = "operates on the session user's own opt-out, so no tenant scope applies";

export const digestTrpcTransport: TrpcRouterDeclaration<DigestApi, typeof digestTrpc> =
  defineTrpcRouter(DigestApi, digestTrpc)
    .procedure("setArmed")
    .withMiddlewareContext(operatorContext)
    .withPermission("ops:manage", STAFF)
    .handle(({ app, input }, operator) => app.setArmed({ ...input, operator }))

    .procedure("sendTest")
    .withMiddlewareContext(operatorContext)
    .withPermission("ops:manage", STAFF)
    .handle(async ({ app, input }, operator) => {
      await app.sendTest({ ...input, operator });
      return { ok: true as const };
    })

    .procedure("sendMyTests")
    .withMiddlewareContext(operatorContext)
    .withPermission("ops:manage", STAFF)
    .handle(({ app }, operator) => app.sendMyTests({ operator }))

    .procedure("getMyPreference")
    .noPermission({ reason: OWN_PREFERENCE })
    // Read-only under impersonation: the person's own choice, shown, never changed.
    .handle(({ app, actor }) => app.getPreference({ userId: actor.id }))

    .procedure("setMyPreference")
    .noPermission({ reason: OWN_PREFERENCE })
    .handle(({ app, actor, input }) =>
      app.setPreference({
        userId: actor.id,
        subscribed: input.subscribed,
        impersonatorId: actor.type === "user" ? actor.impersonatorId : undefined,
      }),
    )
    .build();
