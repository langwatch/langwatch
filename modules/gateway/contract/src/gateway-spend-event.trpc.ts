/**
 * The `gatewaySpendEvents.*` procedure, declared once: a read-only, newest-
 * first, cursor-paged view over `gateway_spend`. Project-scoped, like the
 * neighbouring usage reads; organization-wide rollups are a later fast-follow.
 */
import { z } from "zod";
import { defineTrpcContract } from "@langwatch/api/contract";

import { spendFiltersSchema } from "./gateway-spend.schemas.ts";
import { gatewaySpendEventPageSchema } from "./gateway.responses.ts";

const listInputSchema = z.object({
  projectId: z.string(),
  fromMs: z.number().int(),
  toMs: z.number().int(),
  // The same filter set the REST reads narrow on, in the structured
  // spelling rather than the query-string one, so the screen and a
  // reconciliation script cannot come to mean different things by the
  // same narrowing.
  filters: spendFiltersSchema.optional(),
  cursor: z
    .object({
      occurredAtMs: z.number().int(),
      gatewayRequestId: z.string(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const gatewaySpendEventTrpc = defineTrpcContract("gatewaySpendEvents")
  .query("list")
  .withInput(listInputSchema)
  .withOutput(gatewaySpendEventPageSchema)
  .build();
