/**
 * Every `insights.*` procedure, declared once. Reads refetch on any insight event, so a
 * teammate's filing or this reader's own act in another tab shows up without a timer.
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
