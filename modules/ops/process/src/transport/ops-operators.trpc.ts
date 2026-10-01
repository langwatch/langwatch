/**
 * The server half of the Operators page. Platform-tier - see `ops-operator.trpc.ts`. Grant and
 * revoke also need a non-impersonated session; authz refuses self-grant and the last holder.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsOperatorsTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsOperatorsTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsOperatorsTrpc> =
  defineTrpcRouter(OpsApi, opsOperatorsTrpc)
    .procedure("listPlatformOperators")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      return app.listPlatformOperators();
    })

    .procedure("grantPlatformOperator")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      return app.grantPlatformOperator({ email: input.email, operator });
    })

    .procedure("revokePlatformOperator")
    .withFacts(opsOperatorFact)
    .serviceAuthorized(OPS_MANAGE)
    .handle(async ({ app, input }, operator) => {
      await app.admitOperator(operator, "ops:manage");

      await app.revokePlatformOperator({ grantId: input.grantId, operator });
      return { ok: true } as const;
    })
    .build();
