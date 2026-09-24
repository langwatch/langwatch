// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What `/api/auth/cli` reads off the wire, on the shapes released `langwatch`
 * builds already send: snake_case bodies, a `1` flag for a boolean query and a
 * bounded page size. The transport declares these; nothing here knows Hono.
 */
import { z } from "zod";

import { cliBootstrapResultSchema } from "./cli-bootstrap.ts";
import { governanceSetupStateSchema } from "./governance.ts";
import {
  activityEventDetailRowSchema,
  sourceHealthMetricsSchema,
} from "./ingestion-source-activity.queries.ts";
import { governanceBudgetOverviewForUserSchema } from "./personal-budget-overview.ts";

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

export const governanceCliSourceParamsSchema = z.object({ sourceId: z.string().min(1) });

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

const cliRefusalSchema = z.object({
  error: z.string(),
  error_description: z.string(),
  upgrade_url: z.string().optional(),
});
const cliBudgetRefusalSchema = z.object({
  error: z.object({
    type: z.literal("budget_exceeded"),
    scope: z.string(),
    limit_usd: z.string(),
    spent_usd: z.string(),
    period: z.string(),
    request_increase_url: z.string(),
    admin_email: z.string().nullable(),
  }),
});
const cliProjectSchema = z.object({ id: z.string(), slug: z.string(), name: z.string() });

// Released CLI versions read OAuth-shaped errors and the budget preflight's 402 document.
export const governanceCliRefusalAnswers = {
  400: cliRefusalSchema,
  401: cliRefusalSchema,
  402: cliRefusalSchema,
  403: cliRefusalSchema,
  404: cliRefusalSchema,
  409: cliRefusalSchema,
  412: cliRefusalSchema,
  500: cliRefusalSchema,
} as const;

export const governanceCliBudgetStatusAnswers = {
  200: z.object({ ok: z.literal(true) }),
  ...governanceCliRefusalAnswers,
  402: cliBudgetRefusalSchema,
} as const;
export const governanceCliBootstrapAnswers = {
  200: cliBootstrapResultSchema,
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliBudgetOverviewAnswers = {
  200: governanceBudgetOverviewForUserSchema,
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliPersonalProjectAnswers = {
  200: z.object({ project: z.object({ ...cliProjectSchema.shape, api_key: z.string() }) }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliVirtualKeyAnswers = {
  201: z.object({ id: z.string(), secret: z.string(), prefix: z.string() }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliProjectKeyAnswers = {
  200: z.object({ api_key: z.string(), project: cliProjectSchema }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionSourcesAnswers = {
  200: z.object({
    sources: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sourceType: z.string(),
        description: z.string().nullable(),
        status: z.string(),
        lastEventAt: z.string().nullable(),
        createdAt: z.string(),
        archivedAt: z.string().nullable(),
      }),
    ),
  }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionSourceEventsAnswers = {
  200: z.object({ events: z.array(activityEventDetailRowSchema) }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionSourceHealthAnswers = {
  200: z.object({
    source: z.object({ id: z.string(), name: z.string(), status: z.string() }),
    health: sourceHealthMetricsSchema,
  }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliGovernanceStatusAnswers = {
  200: z.object({ setup: governanceSetupStateSchema }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionTemplatesAnswers = {
  200: z.object({ ingestion_templates: z.array(governanceCliIngestionTemplateSchema) }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionKeyAnswers = {
  201: z.object({
    token: z.string(),
    prefix: z.string(),
    endpoint: z.string(),
    project: cliProjectSchema.optional(),
  }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionKeysAnswers = {
  200: z.object({ keys: z.array(governanceCliIngestionKeySchema) }),
  ...governanceCliRefusalAnswers,
} as const;
export const governanceCliIngestionKeyStateAnswers = {
  200: z.object({
    lookup_id: z.string(),
    status: z.enum(["unknown", "live", "revoked"]),
    source_type: z.string().optional(),
    revocation_cause: z.string().nullable().optional(),
  }),
  ...governanceCliRefusalAnswers,
} as const;

/** Each status a route declares, paired with the body it answers under it. */
export type GovernanceCliAnswerOf<Answers extends Readonly<Record<number, z.ZodType>>> = {
  [Status in keyof Answers & number]: { status: Status; body: z.infer<Answers[Status]> };
}[keyof Answers & number];
export type GovernanceCliRefusalAnswer = GovernanceCliAnswerOf<typeof governanceCliRefusalAnswers>;
export type GovernanceCliBudgetStatusAnswer = GovernanceCliAnswerOf<
  typeof governanceCliBudgetStatusAnswers
>;
export type GovernanceCliBootstrapAnswer = GovernanceCliAnswerOf<
  typeof governanceCliBootstrapAnswers
>;
export type GovernanceCliBudgetOverviewAnswer = GovernanceCliAnswerOf<
  typeof governanceCliBudgetOverviewAnswers
>;
export type GovernanceCliPersonalProjectAnswer = GovernanceCliAnswerOf<
  typeof governanceCliPersonalProjectAnswers
>;
export type GovernanceCliVirtualKeyAnswer = GovernanceCliAnswerOf<
  typeof governanceCliVirtualKeyAnswers
>;
export type GovernanceCliProjectKeyAnswer = GovernanceCliAnswerOf<
  typeof governanceCliProjectKeyAnswers
>;
export type GovernanceCliIngestionSourcesAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionSourcesAnswers
>;
export type GovernanceCliIngestionSourceEventsAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionSourceEventsAnswers
>;
export type GovernanceCliIngestionSourceHealthAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionSourceHealthAnswers
>;
export type GovernanceCliGovernanceStatusAnswer = GovernanceCliAnswerOf<
  typeof governanceCliGovernanceStatusAnswers
>;
export type GovernanceCliIngestionTemplatesAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionTemplatesAnswers
>;
export type GovernanceCliIngestionKeyAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionKeyAnswers
>;
export type GovernanceCliIngestionKeysAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionKeysAnswers
>;
export type GovernanceCliIngestionKeyStateAnswer = GovernanceCliAnswerOf<
  typeof governanceCliIngestionKeyStateAnswers
>;

export const governanceCliHeadersSchema = z.object({
  authorization: z.string().nullable().default(null),
});

export type GovernanceCliRequest = Readonly<{ authorization: string | null }>;
export type GovernanceCliRawRequest = GovernanceCliRequest & Readonly<{ raw: string }>;
export type GovernanceCliSourcesRequest = GovernanceCliRequest &
  Readonly<{ includeArchived: boolean }>;
export type GovernanceCliSourceEventsRequest = GovernanceCliRequest &
  Readonly<{ sourceId: string; limit: number; beforeIso: string | undefined }>;
export type GovernanceCliSourceRequest = GovernanceCliRequest & Readonly<{ sourceId: string }>;
export type GovernanceCliKeyLookupRequest = GovernanceCliRequest & Readonly<{ lookupId: string }>;
