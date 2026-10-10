/**
 * Every `pinnedTrace.*` procedure, declared once. A pin exempts one trace from
 * the project's retention sweep; unpinning is refused while a share link still
 * holds the trace, which is why the namespace answers from share.
 */

import { pinnedTraceSchema } from "@langwatch/data-retention-contract";
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

const pinnedTraceScopeSchemaDefinition = z.object({
  projectId: z.string(),
  traceId: z.string(),
});
export interface PinnedTraceScopeSchema extends Named<typeof pinnedTraceScopeSchemaDefinition> {}
export const pinnedTraceScopeSchema: PinnedTraceScopeSchema = pinnedTraceScopeSchemaDefinition;

const pinnedTracePinInputSchemaDefinition = z.object({
  ...pinnedTraceScopeSchema.shape,
  reason: z.string().optional(),
});
export interface PinnedTracePinInputSchema extends Named<
  typeof pinnedTracePinInputSchemaDefinition
> {}
export const pinnedTracePinInputSchema: PinnedTracePinInputSchema =
  pinnedTracePinInputSchemaDefinition;

const pinnedTraceProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface PinnedTraceProjectInputSchema extends Named<
  typeof pinnedTraceProjectInputSchemaDefinition
> {}
export const pinnedTraceProjectInputSchema: PinnedTraceProjectInputSchema =
  pinnedTraceProjectInputSchemaDefinition;

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
