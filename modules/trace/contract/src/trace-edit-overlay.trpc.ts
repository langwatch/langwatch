/**
 * Every `traceEditOverlay.*` procedure. Reading needs `traces:view`, writing
 * needs `annotations:update`. A correction quotes its trace, so the read
 * applies the same content gates the trace itself would.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { traceEditOverlayPatchSchema } from "./trace-edit-overlay.contract.ts";
import { traceEditOverlayDtoSchema, traceEditOverlayOrNullSchema } from "./trace.responses.ts";

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

const upsertInputSchema = z.object({
  ...traceScopeSchema.shape,
  patch: traceEditOverlayPatchSchema,
});

export const traceEditOverlayTrpc = defineTrpcContract("traceEditOverlay")
  .query("getByTraceId")
  .withInput(traceScopeSchema)
  .withOutput(traceEditOverlayOrNullSchema)

  /**
   * Saves the correction, replacing the previous one. The patch is composed
   * on top of what the read handed the caller, so withheld edits carry over
   * rather than dropping; removing one outright stays the separate `delete`.
   */
  .mutation("upsert")
  .withInput(upsertInputSchema)
  .withOutput(traceEditOverlayDtoSchema)

  .mutation("delete")
  .withInput(traceScopeSchema)
  .build();
