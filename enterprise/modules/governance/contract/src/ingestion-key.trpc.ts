// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `ingestionKey.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { issuedIngestionKeySchema } from "./ingestion-source-key.commands.ts";

/** One of the caller's live personal ingestion keys, without its secret. */
export const personalIngestionKeyListingSchema = z
  .object({
    apiKeyId: z.string(),
    name: z.string(),
    sourceType: z.string(),
    lookupId: z.string(),
    ingestionTemplateId: z.string().nullable(),
    deviceLabel: z.string().nullable(),
    parentApiKeyId: z.string().nullable(),
    createdAtMs: z.number(),
    lastUsedAtMs: z.number().nullable(),
  })
  .strict();
export type PersonalIngestionKeyListing = z.infer<typeof personalIngestionKeyListingSchema>;

export const ingestionKeyMintInputSchema = z.object({
  organizationId: z.string(),
  sourceType: z.string().min(1),
  templateId: z.string().min(1).optional(),
});

export const rotatedIngestionKeySchema = issuedIngestionKeySchema.safeExtend({
  revokedCount: z.number().int().nonnegative(),
  revokedDeviceLabels: z.array(z.string()),
});
export type RotatedIngestionKey = z.infer<typeof rotatedIngestionKeySchema>;

export const ingestionKeyTrpc = defineTrpcContract("ingestionKey")
  .query("list")
  .withInput(z.object({ organizationId: z.string() }))
  .withOutput(personalIngestionKeyListingSchema.array())

  .mutation("install")
  .withInput(ingestionKeyMintInputSchema)
  .withOutput(issuedIngestionKeySchema)

  .mutation("rotate")
  .withInput(ingestionKeyMintInputSchema)
  .withOutput(rotatedIngestionKeySchema)

  .mutation("revoke")
  .withInput(z.object({ organizationId: z.string(), apiKeyId: z.string() }))
  .withOutput(z.object({ success: z.literal(true) }))
  .build();

/** A personal mint as the ops take it: the caller named, the template resolved to null. */
export type PersonalIngestionKeyMint = {
  userId: string;
  organizationId: string;
  sourceType: string;
  ingestionTemplateId: string | null;
};
