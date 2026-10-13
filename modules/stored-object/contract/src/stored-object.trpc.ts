/**
 * Every `storedObjects.*` procedure, declared once: name, kind, input, answer.
 * The probe's own two schemas live here because nothing else asks either
 * question.
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  storedObjectsConfirmUploadInputSchema,
  storedObjectsConfirmUploadOutputSchema,
  storedObjectsCreateUploadInputSchema,
  storedObjectsCreateUploadOutputSchema,
} from "./uploads.ts";

const storedObjectHeadInputSchemaDefinition = z.object({
  projectId: z.string(),
  id: z.string(),
});
export interface StoredObjectHeadInputSchema extends Named<
  typeof storedObjectHeadInputSchemaDefinition
> {}
export const storedObjectHeadInputSchema: StoredObjectHeadInputSchema =
  storedObjectHeadInputSchemaDefinition;
export type StoredObjectHeadInput = z.infer<typeof storedObjectHeadInputSchema>;

/**
 * The tri-state `/api/files/:id` reports: the bytes are there, the row is there
 * and the blob is gone, or no row matches.
 */
const storedObjectHeadSchemaDefinition = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("missing"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
]);
export interface StoredObjectHeadSchema extends Named<typeof storedObjectHeadSchemaDefinition> {}
export const storedObjectHeadSchema: StoredObjectHeadSchema = storedObjectHeadSchemaDefinition;
export type StoredObjectHead = z.infer<typeof storedObjectHeadSchema>;

const storedObjectReadUrlInputSchemaDefinition = z.object({
  projectId: z.string(),
  storedObjectId: z.string(),
  /** The name the bytes download under; the object's id when absent. */
  filename: z.string().optional(),
});
export interface StoredObjectReadUrlInputSchema extends Named<
  typeof storedObjectReadUrlInputSchemaDefinition
> {}
export const storedObjectReadUrlInputSchema: StoredObjectReadUrlInputSchema =
  storedObjectReadUrlInputSchemaDefinition;
export type StoredObjectReadUrlInput = z.infer<typeof storedObjectReadUrlInputSchema>;

/** A same-origin URL whose signature is the credential; it lapses after a few minutes. */
const storedObjectReadUrlSchemaDefinition = z.object({ url: z.string() }).strict();
export interface StoredObjectReadUrlSchema extends Named<
  typeof storedObjectReadUrlSchemaDefinition
> {}
export const storedObjectReadUrlSchema: StoredObjectReadUrlSchema =
  storedObjectReadUrlSchemaDefinition;
export type StoredObjectReadUrl = z.infer<typeof storedObjectReadUrlSchema>;

export const storedObjectTrpc = defineTrpcContract("storedObjects")
  /**
   * Probes whether a stored object's row AND bytes exist. The renderer maps
   * `missing` to the placeholder badge and `not_found` to a generic error.
   */
  .query("headById")
  .withInput(storedObjectHeadInputSchema)
  .withOutput(storedObjectHeadSchema)
  /** A short-lived signed URL the browser renders an object's bytes from (Alex, 2026-09-30). */
  .query("getReadUrl")
  .withInput(storedObjectReadUrlInputSchema)
  .withOutput(storedObjectReadUrlSchema)
  .mutation("createUpload")
  .withInput(storedObjectsCreateUploadInputSchema)
  .withOutput(storedObjectsCreateUploadOutputSchema)
  .mutation("confirmUpload")
  .withInput(storedObjectsConfirmUploadInputSchema)
  .withOutput(storedObjectsConfirmUploadOutputSchema)
  .build();
