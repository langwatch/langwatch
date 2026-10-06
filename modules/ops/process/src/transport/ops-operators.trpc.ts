/**
 * The server half of the Operators page. Platform-tier, asked at the door. Grant and
 * revoke also need a non-impersonated session; authz refuses self-grant and the last holder.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsOperatorsTrpc } from "@langwatch/ops-contract";

import { opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsOperatorsTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsOperatorsTrpc> =
  defineTrpcRouter(OpsApi, opsOperatorsTrpc)
    .procedure("listPlatformOperators")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app }) => app.listPlatformOperators())

    .procedure("grantPlatformOperator")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) =>
      app.grantPlatformOperator({ email: input.email, operator }),
    )

    .procedure("revokePlatformOperator")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input }, operator) => {
      await app.revokePlatformOperator({ grantId: input.grantId, operator });
      return { ok: true } as const;
    })
    .build();
