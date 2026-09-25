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

import {
  connectionReconciliationSchema,
  organizationReconciliationSchema,
  scimReconciliationScopeSchema,
} from "./scim-reconciliation.ts";
import { scimConnectionRequestsInputSchema, scimRequestEntrySchema } from "./scim-request-log.ts";

export const scimReconciliationTrpc = defineTrpcContract("scimReconciliation")
  /**
   * Where every one of the organization's directory syncs stands (ADR-122).
   *
   * Read-only, deliberately and permanently: the remediation for a failed
   * apply is the directory's next push, which re-asserts everything it still
   * believes, and a control here would be a second thing pushing the same
   * state.
   */
  .query("getAll")
  .withInput(scimReconciliationScopeSchema)
  .withOutput(organizationReconciliationSchema)
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
  /** One connection's panel; null for a connection this organization does not have. */
  .query("getById")
  .withInput(scimConnectionRequestsInputSchema)
  .withOutput(connectionReconciliationSchema.nullable())
  .build();
