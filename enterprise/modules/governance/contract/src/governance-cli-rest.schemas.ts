// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What `/api/auth/cli` reads off the wire, on the shapes released `langwatch`
 * builds already send: snake_case bodies, a `1` flag for a boolean query and a
 * bounded page size. The transport declares these; nothing here knows Hono.
 */
import { z } from "zod";

/** The smallest and largest page one source's event feed will serve. */
const EVENTS_PAGE_DEFAULT = 50;
const EVENTS_PAGE_MAX = 200;

export const governanceCliVirtualKeyRequestSchema = z.object({
  device_label: z.string().optional(),
});

export const governanceCliProjectKeyRequestSchema = z.object({
  slug: z.string().min(1),
});

export const governanceCliIngestionKeyRequestSchema = z.object({
  source_type: z.string().min(1),
  /**
   * Project id or slug, resolved inside the caller's organization only. Omit
   * for the caller's personal project.
   */
  project: z.string().min(1).optional(),
  /**
   * Machine this key is for, shown as provenance on the API-keys page. Capped
   * like every other device label the CLI sends, and sanitized before it
   * reaches the key name.
   */
  device_label: z.string().min(1).max(128).optional(),
});

export const governanceCliSourceParamsSchema = z.object({ id: z.string().min(1) });

export const governanceCliKeyLookupParamsSchema = z.object({ lookup_id: z.string().min(1) });

/** `include_archived=1` is the only truthy spelling the CLI has ever sent. */
export const governanceCliSourcesQuerySchema = z.object({
  include_archived: z
    .string()
    .optional()
    .transform((declared) => declared === "1"),
});

/**
 * A page of one source's events. Both fields are optional and neither can
 * refuse the request: an unreadable `limit` falls back to the default rather
 * than reaching the read as `NaN`.
 */
export const governanceCliSourceEventsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((declared) => {
      const parsed = declared === void 0 ? Number.NaN : Number.parseInt(declared, 10);

      if (!Number.isFinite(parsed)) return EVENTS_PAGE_DEFAULT;

      return Math.min(Math.max(1, parsed), EVENTS_PAGE_MAX);
    }),
  before_iso: z.string().optional(),
});

/**
 * One ingestion template as the CLI reads it. Distinct from the project-key
 * REST's `{ data: [...] }` envelope: this door answers `ingestion_templates`.
 */
export const governanceCliIngestionTemplateSchema = z.object({
  id: z.string(),
  organization_id: z.string().nullable(),
  slug: z.string(),
  source_type: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  icon_asset: z.string().nullable(),
  credential_schema: z.string().nullable(),
  ottl_rules: z.string(),
  platform_published: z.boolean(),
  enabled: z.boolean(),
});

export type GovernanceCliIngestionTemplate = z.infer<typeof governanceCliIngestionTemplateSchema>;

/** One live personal ingestion key, as the CLI's cache-liveness pre-flight reads it. */
export const governanceCliIngestionKeySchema = z.object({
  source_type: z.string(),
  lookup_id: z.string(),
  ingestion_template_id: z.string().nullable(),
});

export type GovernanceCliIngestionKey = z.infer<typeof governanceCliIngestionKeySchema>;
