// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `aiTools.*` procedure, declared once, at main's wire names (main `ee/governance/routers/aiTools.ts`). */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  aiToolEntrySchema,
  aiToolOtlpEndpointSchema,
  aiToolProviderAvailabilitySchema,
  aiToolProviderOptionSchema,
  aiToolRoutingPolicyOptionSchema,
  aiToolStarterPackImportSchema,
  aiToolStarterTileChoiceSchema,
  aiToolTypeSchema,
} from "./ai-tool-catalog.ts";
import { governanceWriteAcknowledgedSchema } from "./governance.responses.ts";

const organizationScope = z.object({ organizationId: z.string() });
const entryInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

/** A preset (`preset:<kind>` or `preset:<namespace>:<kind>`) or a base64 image data URL, capped at 256KB. */
const iconAssetSchema = z
  .string()
  .max(262_144)
  .regex(
    /^(preset:[a-z0-9_]+(?::[a-z0-9_]+)?|data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/,
    {
      message:
        "iconAsset must be 'preset:<kind>', 'preset:<namespace>:<kind>', or a base64 data URL (svg, png, jpeg, webp)",
    },
  )
  .nullable()
  .optional();

export const aiToolCreateSchema = z.object({
  ...organizationScope.shape,
  departmentIds: z.array(z.string()).default([]),
  type: aiToolTypeSchema,
  displayName: z.string().min(1).max(128),
  iconAsset: iconAssetSchema,
  order: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()),
});

export const aiToolUpdateSchema = z.object({
  ...entryInOrganization.shape,
  displayName: z.string().min(1).max(128).optional(),
  iconAsset: iconAssetSchema,
  departmentIds: z.array(z.string()).optional(),
  order: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  type: aiToolTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const aiToolsTrpc = defineTrpcContract("aiTools")
  .query("list")
  .withInput(organizationScope)
  .withOutput(aiToolEntrySchema.array())

  .query("providerAvailability")
  .withInput(organizationScope)
  .withOutput(aiToolProviderAvailabilitySchema)

  .query("claudeCodeOtlpEndpoint")
  .withInput(organizationScope)
  .withOutput(aiToolOtlpEndpointSchema)

  .query("adminList")
  .withInput(organizationScope)
  .withOutput(aiToolEntrySchema.array())

  .query("get")
  .withInput(entryInOrganization)
  .withOutput(aiToolEntrySchema)

  .mutation("create")
  .withInput(aiToolCreateSchema)
  .withOutput(aiToolEntrySchema)

  .mutation("update")
  .withInput(aiToolUpdateSchema)
  .withOutput(aiToolEntrySchema)

  .mutation("remove")
  .withInput(entryInOrganization)
  .withOutput(aiToolEntrySchema)

  .mutation("setEnabled")
  .withInput(z.object({ ...entryInOrganization.shape, enabled: z.boolean() }))
  .withOutput(aiToolEntrySchema)

  .mutation("importStarterPack")
  .withInput(z.object({ ...organizationScope.shape, slugs: z.array(z.string()).min(1).optional() }))
  .withOutput(aiToolStarterPackImportSchema)

  .query("starterPackCatalog")
  .withInput(organizationScope)
  .withOutput(aiToolStarterTileChoiceSchema.array())

  .query("providerOptions")
  .withInput(organizationScope)
  .withOutput(aiToolProviderOptionSchema.array())

  .query("routingPolicyOptions")
  .withInput(organizationScope)
  .withOutput(aiToolRoutingPolicyOptionSchema.array())

  .mutation("reorder")
  .withInput(
    z.object({
      ...organizationScope.shape,
      updates: z.array(z.object({ id: z.string(), order: z.number().int().min(0) })).min(1),
    }),
  )
  .withOutput(governanceWriteAcknowledgedSchema)
  .build();
