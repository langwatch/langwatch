/**
 * Every `storedObjects.*` procedure, declared once: name, kind, input, answer.
 * The probe's own two schemas live here because nothing else asks either
 * question.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

export const storedObjectHeadInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});
export type StoredObjectHeadInput = z.infer<typeof storedObjectHeadInputSchema>;

/**
 * The tri-state `/api/files/:id` reports: the bytes are there, the row is there
 * and the blob is gone, or no row matches.
 */
export const storedObjectHeadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("missing"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
]);
export type StoredObjectHead = z.infer<typeof storedObjectHeadSchema>;

export const storedObjectTrpc = defineTrpcContract("storedObjects")
  /**
   * Probes whether a stored object's row AND bytes exist. The renderer maps
   * `missing` to the placeholder badge and `not_found` to a generic error.
   */
  .query("headById")
  .withInput(storedObjectHeadInputSchema)
  .withOutput(storedObjectHeadSchema)
  .build();
