// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of the self-hosted instance registry (ADR-156, section 10): the platform
 * door hides it from non-staff (Q42); the cloud-ops capability is the application's.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { EnterpriseOpsApi, selfHostedInstancesTrpc } from "@langwatch/enterprise-ops-contract";

import { operatorContext, STAFF } from "./license-registry.trpc.ts";

export const selfHostedInstancesTrpcTransport: TrpcRouterDeclaration<
  EnterpriseOpsApi,
  typeof selfHostedInstancesTrpc
> = defineTrpcRouter(EnterpriseOpsApi, selfHostedInstancesTrpc)
  .procedure("getAll")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.listSelfHostedInstances({ ...input, operator }))

  .procedure("getById")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.getSelfHostedInstance({ ...input, operator }))
  .build();
