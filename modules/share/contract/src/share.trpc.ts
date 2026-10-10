/**
 * Every `share.*` procedure, declared once. Anonymous reads are NOT here: they
 * go through `sharedTrace.get`, the single public trace read ADR-057 allows.
 * This namespace only mints, lists and revokes links.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { shareLinkSchema, shareResourceTypeSchema, shareVisibilitySchema } from "./share.ts";

const shareListForResourceInputSchemaDefinition = z.object({
  projectId: z.string(),
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
});
export interface ShareListForResourceInputSchema extends Named<
  typeof shareListForResourceInputSchemaDefinition
> {}
export const shareListForResourceInputSchema: ShareListForResourceInputSchema =
  shareListForResourceInputSchemaDefinition;

/**
 * TRACE only: `sharedTrace.get` renders a trace and nothing else, so THREAD
 * here would mint a capability no viewer can redeem. See ADR-057.
 */
const shareCreateInputSchemaDefinition = z.object({
  projectId: z.string(),
  resourceType: z.literal("TRACE"),
  resourceId: z.string(),
  visibility: shareVisibilitySchema.default("PUBLIC"),
  expiresAt: z.date().nullish(),
  maxViews: z.number().int().positive().nullish(),
});
export interface ShareCreateInputSchema extends Named<typeof shareCreateInputSchemaDefinition> {}
export const shareCreateInputSchema: ShareCreateInputSchema = shareCreateInputSchemaDefinition;

const shareRevokeInputSchemaDefinition = z.object({ projectId: z.string(), id: z.string() });
export interface ShareRevokeInputSchema extends Named<typeof shareRevokeInputSchemaDefinition> {}
export const shareRevokeInputSchema: ShareRevokeInputSchema = shareRevokeInputSchemaDefinition;

const shareProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface ShareProjectInputSchema extends Named<typeof shareProjectInputSchemaDefinition> {}
export const shareProjectInputSchema: ShareProjectInputSchema = shareProjectInputSchemaDefinition;

export const shareTrpc = defineTrpcContract("share")
  /**
   * All links for a resource — backs the management list in the share drawer.
   * The list re-displays the secret tokens, so the server requires the mint
   * permission rather than the read one.
   */
  .query("listForResource")
  .withInput(shareListForResourceInputSchema)
  .withOutput(shareLinkSchema.array())

  .mutation("createShare")
  .withInput(shareCreateInputSchema)
  .withOutput(shareLinkSchema)

  /** A revocation answers nothing. */
  .mutation("revoke")
  .withInput(shareRevokeInputSchema)
  .withOutput(z.void())

  .query("countTraceShares")
  .withInput(shareProjectInputSchema)
  .withOutput(z.number().int().nonnegative())

  .mutation("revokeAllTraceShares")
  .withInput(shareProjectInputSchema)
  .withOutput(z.void())
  .build();
