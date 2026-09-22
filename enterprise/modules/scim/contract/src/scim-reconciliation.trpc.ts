// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organization's read of its own directory sync (ADR-122, ADR-126).
 *
 * `sso:view` throughout, and deliberately not plan-gated: the headline case
 * for reading the requests is a plan that lapsed, so gating the reader on the
 * plan means the one organization that needs those rows is the one refused
 * them.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { scimConnectionRequestsInputSchema, scimRequestEntrySchema } from "./scim-request-log.ts";

export const scimReconciliationTrpc = defineTrpcContract("scimReconciliation")
  /**
   * Every request the directory made on one connection, newest first.
   *
   * The log says what the directory DECIDED; this says what it ASKED and what
   * we answered, and a push refused before it reached a handler exists only
   * here. An absent row is not evidence that nothing was sent — rows age out.
   */
  .query("getRequests")
  .withInput(scimConnectionRequestsInputSchema)
  .withOutput(scimRequestEntrySchema.array())
  .build();
