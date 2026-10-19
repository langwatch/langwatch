import { HandledError, NotFoundError, ValidationError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  DEFAULT_GOVERNANCE_SURFACE,
  governanceCallSurfaceSchema,
} from "../../admin-workspace-view-audit.ts";

const ingestionTemplateSchemaDefinition = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    sourceType: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().nullable(),
    iconAsset: z.string().nullable(),
    credentialSchema: z.string().nullable(),
    ottlRules: z.string(),
    platformPublished: z.boolean(),
    enabled: z.boolean(),
    organizationId: z.string().nullable(),
  })
  .strict();
export interface IngestionTemplateSchema extends Named<typeof ingestionTemplateSchemaDefinition> {}
export const ingestionTemplateSchema: IngestionTemplateSchema = ingestionTemplateSchemaDefinition;
export type IngestionTemplate = z.infer<typeof ingestionTemplateSchema>;

export const ingestionTemplateSourceTypeSchema = z.string().regex(/^[a-z0-9_]{1,40}$/);

const createIngestionTemplateInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    sourceType: z.string().min(1),
    displayName: z.string().min(1).max(80),
    description: z.string().max(2_000).nullable().optional(),
    iconAsset: z.string().max(20_000).nullable().optional(),
    credentialSchema: z.string().nullable().optional(),
    ottlRules: z.string().max(50_000).optional(),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export interface CreateIngestionTemplateInputSchema extends Named<
  typeof createIngestionTemplateInputSchemaDefinition
> {}
export const createIngestionTemplateInputSchema: CreateIngestionTemplateInputSchema =
  createIngestionTemplateInputSchemaDefinition;
export type CreateIngestionTemplateInput = z.infer<typeof createIngestionTemplateInputSchema>;

const updateIngestionTemplateOttlInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    id: z.string().min(1),
    ottlRules: z.string().max(50_000),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export interface UpdateIngestionTemplateOttlInputSchema extends Named<
  typeof updateIngestionTemplateOttlInputSchemaDefinition
> {}
export const updateIngestionTemplateOttlInputSchema: UpdateIngestionTemplateOttlInputSchema =
  updateIngestionTemplateOttlInputSchemaDefinition;
export type UpdateIngestionTemplateOttlInput = z.infer<
  typeof updateIngestionTemplateOttlInputSchema
>;

const archiveIngestionTemplateInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    id: z.string().min(1),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export interface ArchiveIngestionTemplateInputSchema extends Named<
  typeof archiveIngestionTemplateInputSchemaDefinition
> {}
export const archiveIngestionTemplateInputSchema: ArchiveIngestionTemplateInputSchema =
  archiveIngestionTemplateInputSchemaDefinition;
export type ArchiveIngestionTemplateInput = z.infer<typeof archiveIngestionTemplateInputSchema>;

const cloneIngestionTemplateInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    sourceTemplateId: z.string().min(1),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export interface CloneIngestionTemplateInputSchema extends Named<
  typeof cloneIngestionTemplateInputSchemaDefinition
> {}
export const cloneIngestionTemplateInputSchema: CloneIngestionTemplateInputSchema =
  cloneIngestionTemplateInputSchemaDefinition;
export type CloneIngestionTemplateInput = z.infer<typeof cloneIngestionTemplateInputSchema>;

const platformIngestionTemplateSeedSchemaDefinition = z
  .object({
    slug: z.string().min(1),
    sourceType: ingestionTemplateSourceTypeSchema,
    displayName: z.string().min(1),
    description: z.string(),
    iconAsset: z.string().nullable(),
    credentialSchema: z.enum(["static_api_key", "agent_id"]).nullable(),
    ottlRules: z.string(),
  })
  .strict();
export interface PlatformIngestionTemplateSeedSchema extends Named<
  typeof platformIngestionTemplateSeedSchemaDefinition
> {}
export const platformIngestionTemplateSeedSchema: PlatformIngestionTemplateSeedSchema =
  platformIngestionTemplateSeedSchemaDefinition;
export type PlatformIngestionTemplateSeed = z.infer<typeof platformIngestionTemplateSeedSchema>;

const platformIngestionTemplateSyncResultSchemaDefinition = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  })
  .strict();
export interface PlatformIngestionTemplateSyncResultSchema extends Named<
  typeof platformIngestionTemplateSyncResultSchemaDefinition
> {}
export const platformIngestionTemplateSyncResultSchema: PlatformIngestionTemplateSyncResultSchema =
  platformIngestionTemplateSyncResultSchemaDefinition;
export type PlatformIngestionTemplateSyncResult = z.infer<
  typeof platformIngestionTemplateSyncResultSchema
>;

/** The product currently ships no platform-owned ingestion templates. */
export const PLATFORM_INGESTION_TEMPLATES: readonly PlatformIngestionTemplateSeed[] = [];

/** Platform rows retired from earlier releases. */
export const RETIRED_PLATFORM_TEMPLATE_SLUGS = [
  "raw_otlp_advanced",
  "claude_code",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "claude_cowork",
] as const;

export class PlatformTemplateImmutableError extends HandledError {
  constructor() {
    super(
      "template_immutable",
      "Platform-default templates are read-only. Fork into your org to author OTTL.",
      { httpStatus: 403 },
    );
    this.name = "PlatformTemplateImmutableError";
  }
}

export class TemplateNotFoundError extends NotFoundError {
  constructor(templateId: string) {
    super("template_not_found", { resource: "Ingestion template", id: templateId });
    this.name = "TemplateNotFoundError";
  }
}

export class InvalidSourceTypeError extends ValidationError {
  constructor() {
    const complaint = "sourceType must be lowercase letters / digits / underscores, max 40 chars.";
    super(complaint, { meta: { formErrors: [complaint] } });
    this.name = "InvalidSourceTypeError";
  }
}

export const defaultIngestionTemplateSurface = DEFAULT_GOVERNANCE_SURFACE;
