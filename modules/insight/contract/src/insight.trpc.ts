/**
 * Every `insights.*` procedure, declared once. Reads refetch on any insight event in the
 * project, so a filing or the owner's own act in another tab shows up without a timer. The
 * hint carries no data: the refetch answers the caller's own insights and nobody else's.
 */

import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { INSIGHT_PROCESSING_EVENT_TYPES } from "./insight.constants.ts";
import {
  fileInsightInputSchema,
  insightEntrySchema,
  insightProjectScopeSchema,
  insightScopeSchema,
  markInsightsSeenInputSchema,
} from "./insight.ts";

export const insightTrpc = defineTrpcContract("insights")
  .query("getAll", { invalidatedBy: INSIGHT_PROCESSING_EVENT_TYPES })
  .withInput(insightProjectScopeSchema)
  .withOutput(insightEntrySchema.array())

  .mutation("file")
  .withInput(fileInsightInputSchema)
  .withOutput(insightEntrySchema)

  .mutation("markSeen")
  .withInput(markInsightsSeenInputSchema)
  .withOutput(z.void())

  .mutation("archive")
  .withInput(insightScopeSchema)
  .withOutput(z.void())

  .mutation("keep")
  .withInput(insightScopeSchema)
  .withOutput(z.void())
  .build();
