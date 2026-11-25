// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly digest's operator controls: the platform door hides them from non-staff and refuses
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

export const digestTrpcTransport: TrpcRouterDeclaration<DigestApi, typeof digestTrpc> =
  defineTrpcRouter(DigestApi, digestTrpc)
    .procedure("setEnrolled")
    .withMiddlewareContext(operatorContext)
    .withPermission("ops:manage", STAFF)
    .handle(({ app, input }, operator) => app.setEnrolled({ ...input, operator }))

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
    .build();
