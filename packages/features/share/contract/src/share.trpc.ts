/**
 * Every `share.*` procedure, declared once. Anonymous reads are NOT here: they
 * go through `sharedTrace.get`, the single public trace read ADR-057 allows.
 * This namespace only mints, lists and revokes links.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { shareLinkSchema, shareResourceTypeSchema, shareVisibilitySchema } from "./share.ts";

export const shareListForResourceInputSchema = z.object({
  projectId: z.string(),
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
});

/**
 * TRACE only: `sharedTrace.get` renders a trace and nothing else, so THREAD
 * here would mint a capability no viewer can redeem. See ADR-057.
 */
export const shareCreateInputSchema = z.object({
  projectId: z.string(),
  resourceType: z.literal("TRACE"),
  resourceId: z.string(),
  visibility: shareVisibilitySchema.default("PUBLIC"),
  expiresAt: z.date().nullish(),
  maxViews: z.number().int().positive().nullish(),
});

export const shareRevokeInputSchema = z.object({ projectId: z.string(), id: z.string() });

export const shareProjectInputSchema = z.object({ projectId: z.string() });

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

  .mutation("revokeAllTraceShares")
  .withInput(shareProjectInputSchema)
  .withOutput(z.void())
  .build();
