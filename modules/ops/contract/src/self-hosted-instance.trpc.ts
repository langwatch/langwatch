/** The registry of self-hosted installs (ADR-156 §10), as the Backoffice
 * reads it. Read only: an install reported every number here. */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  listSelfHostedInstancesInputSchema,
  selfHostedInstanceDetailSchema,
  selfHostedInstanceIdInputSchema,
  selfHostedInstancePageSchema,
} from "./self-hosted-instance.ts";

export const selfHostedInstancesTrpc = defineTrpcContract("selfHostedInstances")
  .query("getAll")
  .withInput(listSelfHostedInstancesInputSchema)
  .withOutput(selfHostedInstancePageSchema)

  .query("getById")
  .withInput(selfHostedInstanceIdInputSchema)
  .withOutput(selfHostedInstanceDetailSchema)
  .build();
