// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What `/api/governance` reads and answers, on the wire it has always used:
 * snake_case fields, a `{ data: [...] }` list and a single `ingestion_template`
 * detail. The transport declares these; nothing here knows about Hono.
 */
import { z } from "zod";

/** One ingestion template as this family publishes it. */
export const ingestionTemplateDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  source_type: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  icon_asset: z.string().nullable(),
  credential_schema: z.string().nullable(),
  ottl_rules: z.string(),
  platform_published: z.boolean(),
  enabled: z.boolean(),
  organization_id: z.string().nullable(),
});

export type IngestionTemplateDto = z.infer<typeof ingestionTemplateDtoSchema>;

/**
 * `otlp_token` is this door's own vocabulary for "no credential schema at
 * all"; the domain stores that as absent.
 */
export const governanceRestCreateTemplateSchema = z.object({
  source_type: z.string(),
  display_name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  icon_asset: z.string().max(20_000).optional(),
  credential_schema: z.enum(["otlp_token", "static_api_key", "agent_id"]).nullable().optional(),
  ottl_rules: z.string().max(50_000).optional(),
});

export const governanceRestUpdateOttlRulesSchema = z.object({
  ottl_rules: z.string().max(50_000),
});

export const governanceRestCloneTemplateSchema = z.object({
  source_template_id: z.string(),
});

export const governanceRestTemplateParamsSchema = z.object({
  ingestionTemplateId: z.string().min(1),
});

export const governanceRestTemplateListSchema = z.object({
  data: z.array(ingestionTemplateDtoSchema),
});

export const governanceRestTemplateDetailSchema = z.object({
  ingestion_template: ingestionTemplateDtoSchema,
});

export const governanceRestTemplateArchivedSchema = z.object({ archived: z.literal(true) });
