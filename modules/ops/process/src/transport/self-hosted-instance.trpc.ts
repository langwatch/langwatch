/**
 * The server half of the self-hosted instance registry (ADR-156, section
 * 10), gated inside the application the same not-found way as every other
 * Backoffice resource.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, selfHostedInstancesTrpc } from "@langwatch/ops-contract";

import { OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const selfHostedInstancesTrpcTransport = defineTrpcRouter(OpsApi, selfHostedInstancesTrpc)
  .procedure("getAll")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => app.listSelfHostedInstances({ ...input, operator }))

  .procedure("getById")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => app.getSelfHostedInstance({ ...input, operator }))
  .build();
