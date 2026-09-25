// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of the self-hosted instance registry (ADR-156, section
 * 10), gated inside the application the same not-found way as every other
 * Backoffice resource.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EnterpriseOpsApi, selfHostedInstancesTrpc } from "@langwatch/enterprise-ops-contract";

import { operatorFact, STAFF_LIST } from "./enterprise-ops-operator.trpc.ts";

export const selfHostedInstancesTrpcTransport = defineTrpcRouter(
  EnterpriseOpsApi,
  selfHostedInstancesTrpc,
)
  .procedure("getAll")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.listSelfHostedInstances({ ...input, operator }))

  .procedure("getById")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.getSelfHostedInstance({ ...input, operator }))
  .build();
