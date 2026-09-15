/**
 * Every `gatewayUsage.*` procedure, declared once. Organization-scoped like
 * the keys themselves: usage spans every project, because traces land in a
 * key's own destination rather than in the viewer's selected project.
 */

import { z } from "zod";
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  gatewayUsageSummarySchema,
  gatewayVirtualKeyUsageSummarySchema,
} from "./gateway.responses.ts";

const usageSummaryInputSchema = z.object({
  organizationId: z.string(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
});

const usageSummaryForVirtualKeyInputSchema = z.object({
  organizationId: z.string(),
  virtualKeyId: z.string(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  /** Narrows the recent-activity list, and nothing else, to one model. */
  model: z.string().min(1).max(256).optional(),
});

export const gatewayUsageTrpc = defineTrpcContract("gatewayUsage")
  .query("summary")
  .withInput(usageSummaryInputSchema)
  .withOutput(gatewayUsageSummarySchema)

  .query("summaryForVirtualKey")
  .withInput(usageSummaryForVirtualKeyInputSchema)
  .withOutput(gatewayVirtualKeyUsageSummarySchema)
  .build();
