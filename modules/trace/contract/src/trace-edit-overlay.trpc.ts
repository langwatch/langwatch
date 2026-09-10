/**
 * Every `traceEditOverlay.*` procedure, declared once. Reading needs
 * `traces:view`; writing needs `annotations:update`, the same family the
 * suggest-an-output flow sits in. A correction quotes the trace it corrects,
 * so the read applies the same content gates the trace itself would.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { traceEditOverlayPatchSchema } from "./trace-edit-overlay.contract.ts";
import { traceEditOverlayDtoSchema, traceEditOverlayOrNullSchema } from "./trace.responses.ts";

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });

const upsertInputSchema = traceScopeSchema.extend({ patch: traceEditOverlayPatchSchema });

export const traceEditOverlayTrpc = defineTrpcContract("traceEditOverlay")
  .query("getByTraceId")
  .withInput(traceScopeSchema)
  .withOutput(traceEditOverlayOrNullSchema)

  /**
   * Saves the correction, replacing the previous one.
   *
   * The saved patch is composed on top of what the read handed the caller,
   * so the edits withheld from them are carried over rather than dropped,
   * and the answer that goes back is redacted the same way the read is.
   * Removing a correction outright stays the separate, deliberate `delete`.
   */
  .mutation("upsert")
  .withInput(upsertInputSchema)
  .withOutput(traceEditOverlayDtoSchema)

  .mutation("delete")
  .withInput(traceScopeSchema)
  .build();
