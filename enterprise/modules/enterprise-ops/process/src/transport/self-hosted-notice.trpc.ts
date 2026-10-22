// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of Cloud admin's notices to self-hosted installs: the platform door hides it
 * from non-staff and refuses a write to staff lacking ops:manage (Q42), as the license registry.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { EnterpriseOpsApi, selfHostedNoticesTrpc } from "@langwatch/enterprise-ops-contract";

import { operatorContext, STAFF } from "./license-registry.trpc.ts";

export const selfHostedNoticesTrpcTransport: TrpcRouterDeclaration<
  EnterpriseOpsApi,
  typeof selfHostedNoticesTrpc
> = defineTrpcRouter(EnterpriseOpsApi, selfHostedNoticesTrpc)
  .procedure("getAll")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app }, operator) => app.listSelfHostedNotices({ operator }))

  .procedure("create")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.createSelfHostedNotice({ ...input, operator }))

  .procedure("update")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.updateSelfHostedNotice({ ...input, operator }))

  .procedure("publish")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.publishSelfHostedNotice({ ...input, operator }))

  .procedure("withdraw")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.withdrawSelfHostedNotice({ ...input, operator }))
  .build();
