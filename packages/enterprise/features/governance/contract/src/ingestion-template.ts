import {
  HandledError,
  NotFoundError,
  ValidationError,
} from "@langwatch/handled-error";
import { z } from "zod";
import {
  DEFAULT_GOVERNANCE_SURFACE,
  governanceCallSurfaceSchema,
} from "./governance-audit";

export const ingestionTemplateSchema = z
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
export type IngestionTemplate = z.infer<typeof ingestionTemplateSchema>;

export const ingestionTemplateSourceTypeSchema = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/);

export const createIngestionTemplateInputSchema = z
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
export type CreateIngestionTemplateInput = z.infer<
  typeof createIngestionTemplateInputSchema
>;

export const updateIngestionTemplateOttlInputSchema = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    id: z.string().min(1),
    ottlRules: z.string().max(50_000),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export type UpdateIngestionTemplateOttlInput = z.infer<
  typeof updateIngestionTemplateOttlInputSchema
>;

export const archiveIngestionTemplateInputSchema = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    id: z.string().min(1),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export type ArchiveIngestionTemplateInput = z.infer<
  typeof archiveIngestionTemplateInputSchema
>;

export const cloneIngestionTemplateInputSchema = z
  .object({
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1),
    sourceTemplateId: z.string().min(1),
    surface: governanceCallSurfaceSchema.optional(),
  })
  .strict();
export type CloneIngestionTemplateInput = z.infer<
  typeof cloneIngestionTemplateInputSchema
>;

export const platformIngestionTemplateSeedSchema = z
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
export type PlatformIngestionTemplateSeed = z.infer<
  typeof platformIngestionTemplateSeedSchema
>;

export const platformIngestionTemplateSyncResultSchema = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  })
  .strict();
export type PlatformIngestionTemplateSyncResult = z.infer<
  typeof platformIngestionTemplateSyncResultSchema
>;

/** The product currently ships no platform-owned ingestion templates. */
export const PLATFORM_INGESTION_TEMPLATES: readonly PlatformIngestionTemplateSeed[] =
  [];

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
    super("template_not_found", "Ingestion template", templateId);
    this.name = "TemplateNotFoundError";
  }
}

export class InvalidSourceTypeError extends ValidationError {
  constructor() {
    const complaint =
      "sourceType must be lowercase letters / digits / underscores, max 40 chars.";
    super(complaint, { meta: { formErrors: [complaint] } });
    this.name = "InvalidSourceTypeError";
  }
}

export const defaultIngestionTemplateSurface = DEFAULT_GOVERNANCE_SURFACE;

export abstract class IngestionTemplatesService {
  abstract listForUser(input: {
    organizationId: string;
  }): Promise<IngestionTemplate[]>;
  abstract listForOrgAdmin(input: {
    organizationId: string;
  }): Promise<IngestionTemplate[]>;
  abstract tryFindByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null>;
  abstract getByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate>;
  abstract createOrgTemplate(
    input: CreateIngestionTemplateInput,
  ): Promise<IngestionTemplate>;
  abstract updateOttlRules(
    input: UpdateIngestionTemplateOttlInput,
  ): Promise<IngestionTemplate>;
  abstract archiveOrgTemplate(
    input: ArchiveIngestionTemplateInput,
  ): Promise<void>;
  abstract cloneFromPlatform(
    input: CloneIngestionTemplateInput,
  ): Promise<IngestionTemplate>;
  abstract syncPlatformCatalog(): Promise<PlatformIngestionTemplateSyncResult>;
}
