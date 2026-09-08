/**
 * Every `pinnedTrace.*` procedure, declared once. A pin exempts one trace from
 * the project's retention sweep; unpinning is refused while a share link still
 * holds the trace, which is why the namespace answers from share.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { pinnedTraceSchema } from "@langwatch/data-retention-contract";
import { z } from "zod";

export const pinnedTraceScopeSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
});

export const pinnedTracePinInputSchema = z.object({
  ...pinnedTraceScopeSchema.shape,
  reason: z.string().optional(),
});

export const pinnedTraceProjectInputSchema = z.object({ projectId: z.string() });

export const pinnedTraceTrpc = defineTrpcContract("pinnedTrace")
  .mutation("pin")
  .withInput(pinnedTracePinInputSchema)
  .withOutput(pinnedTraceSchema)

  .mutation("unpin")
  .withInput(pinnedTraceScopeSchema)
  .withOutput(z.void())

  .query("getPin")
  .withInput(pinnedTraceScopeSchema)
  .withOutput(pinnedTraceSchema.nullable())

  .query("listByProject")
  .withInput(pinnedTraceProjectInputSchema)
  .withOutput(pinnedTraceSchema.array())
  .build();
