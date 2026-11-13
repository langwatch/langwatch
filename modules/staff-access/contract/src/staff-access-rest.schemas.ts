/**
 * The agent's wire under `/api/staff-access` (ADR-193): request, status, redeem and end with
 * a requester key; the `ops:read` allowlist with an ops token. Read by the `langwatch` CLI.
 */
import { namesOrganization, STAFF_ACCESS_COPY_SCOPES } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  STAFF_ACCESS_MACHINE_MAX_LENGTH,
  STAFF_ACCESS_REASON_MAX_LENGTH,
  staffAccessRequestStatusSchema,
  staffAccessScopeSchema,
} from "./staff-access.ts";

const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding");

const staffAccessRequestBodySchemaDefinition = z
  .object({
    scopes: z.array(staffAccessScopeSchema).min(1).max(5),
    /** The organization's id or slug; required by, and only with, an organization scope. */
    organization: z.string().trim().min(1).max(200).optional(),
    /** A copy's other organization (id or slug): where a source copies into, or a target from. */
    counterpartOrganization: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(1).max(STAFF_ACCESS_REASON_MAX_LENGTH),
    /** base64url(SHA-256(verifier)): 43 characters. */
    codeChallenge: base64UrlSchema.length(43),
    codeChallengeMethod: z.literal("S256"),
    machine: z.string().trim().min(1).max(STAFF_ACCESS_MACHINE_MAX_LENGTH),
  })
  .strict()
  .superRefine((body, context) => {
    if (new Set(body.scopes).size !== body.scopes.length) {
      context.addIssue({ code: "custom", path: ["scopes"], message: "Each scope once." });
    }
    const organizationScoped = namesOrganization(body.scopes);
    if (organizationScoped && body.organization === undefined) {
      context.addIssue({
        code: "custom",
        path: ["organization"],
        message: "An organization scope needs the organization's id or slug.",
      });
    }
    if (!organizationScoped && body.organization !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["organization"],
        message: "Only an organization scope names an organization.",
      });
    }
    refineCopySide({ body, context });
  });
/** A copy side is approved alone, names its other organization, and only it names one. */
function refineCopySide({
  body,
  context,
}: {
  body: { scopes: string[]; organization?: string; counterpartOrganization?: string };
  context: z.RefinementCtx;
}): void {
  const copySide = body.scopes.some((scope) =>
    (STAFF_ACCESS_COPY_SCOPES as readonly string[]).includes(scope),
  );
  if (copySide && body.scopes.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["scopes"],
      message: "A copy side is approved alone.",
    });
  }
  if (copySide !== (body.counterpartOrganization !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["counterpartOrganization"],
      message: "A copy side, and only a copy side, names the other organization of the copy.",
    });
  }
  if (copySide && body.counterpartOrganization === body.organization) {
    context.addIssue({
      code: "custom",
      path: ["counterpartOrganization"],
      message: "A copy names two different organizations.",
    });
  }
}

export interface StaffAccessRequestBodySchema extends Named<
  typeof staffAccessRequestBodySchemaDefinition
> {}
export const staffAccessRequestBodySchema: StaffAccessRequestBodySchema =
  staffAccessRequestBodySchemaDefinition;
export type StaffAccessRequestBody = z.infer<typeof staffAccessRequestBodySchema>;

const staffAccessRequestCreatedSchemaDefinition = z.object({
  requestId: z.string(),
  approvalUrl: z.string(),
  expiresAt: z.string(),
});
export interface StaffAccessRequestCreatedSchema extends Named<
  typeof staffAccessRequestCreatedSchemaDefinition
> {}
export const staffAccessRequestCreatedSchema: StaffAccessRequestCreatedSchema =
  staffAccessRequestCreatedSchemaDefinition;
export type StaffAccessRequestCreated = z.infer<typeof staffAccessRequestCreatedSchema>;

const staffAccessRequestParamsSchemaDefinition = z.object({ requestId: z.string().min(1) });
export interface StaffAccessRequestParamsSchema extends Named<
  typeof staffAccessRequestParamsSchemaDefinition
> {}
export const staffAccessRequestParamsSchema: StaffAccessRequestParamsSchema =
  staffAccessRequestParamsSchemaDefinition;

const staffAccessRequestStatusAnswerSchemaDefinition = z.object({
  requestId: z.string(),
  status: staffAccessRequestStatusSchema,
  expiresAt: z.string(),
  accessExpiresAt: z.string().nullable(),
});
export interface StaffAccessRequestStatusAnswerSchema extends Named<
  typeof staffAccessRequestStatusAnswerSchemaDefinition
> {}
export const staffAccessRequestStatusAnswerSchema: StaffAccessRequestStatusAnswerSchema =
  staffAccessRequestStatusAnswerSchemaDefinition;
export type StaffAccessRequestStatusAnswer = z.infer<typeof staffAccessRequestStatusAnswerSchema>;

const staffAccessRedeemBodySchemaDefinition = z
  .object({ codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) })
  .strict();
export interface StaffAccessRedeemBodySchema extends Named<
  typeof staffAccessRedeemBodySchemaDefinition
> {}
export const staffAccessRedeemBodySchema: StaffAccessRedeemBodySchema =
  staffAccessRedeemBodySchemaDefinition;

const staffAccessProjectSchemaDefinition = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

const staffAccessRedeemedSchemaDefinition = z.object({
  /** An organization key, when an organization scope was approved. */
  apiKey: z.string().optional(),
  /** An `lwsa_` token for the `ops:read` routes, when that scope was approved. */
  opsToken: z.string().optional(),
  organizationId: z.string().optional(),
  projects: z.array(staffAccessProjectSchemaDefinition),
  scopes: z.array(staffAccessScopeSchema),
  expiresAt: z.string(),
});
export interface StaffAccessRedeemedSchema extends Named<
  typeof staffAccessRedeemedSchemaDefinition
> {}
export const staffAccessRedeemedSchema: StaffAccessRedeemedSchema =
  staffAccessRedeemedSchemaDefinition;
export type StaffAccessRedeemed = z.infer<typeof staffAccessRedeemedSchema>;

const staffAccessNoBodySchemaDefinition = z.object({}).strict();
export interface StaffAccessNoBodySchema extends Named<typeof staffAccessNoBodySchemaDefinition> {}
export const staffAccessNoBodySchema: StaffAccessNoBodySchema = staffAccessNoBodySchemaDefinition;
const staffAccessEndedSchemaDefinition = z.object({ ended: z.literal(true) });
export interface StaffAccessEndedSchema extends Named<typeof staffAccessEndedSchemaDefinition> {}
export const staffAccessEndedSchema: StaffAccessEndedSchema = staffAccessEndedSchemaDefinition;

const staffAccessOrganizationsQuerySchemaDefinition = z.object({
  query: z.string().trim().max(200).optional(),
});
export interface StaffAccessOrganizationsQuerySchema extends Named<
  typeof staffAccessOrganizationsQuerySchemaDefinition
> {}
export const staffAccessOrganizationsQuerySchema: StaffAccessOrganizationsQuerySchema =
  staffAccessOrganizationsQuerySchemaDefinition;

const staffAccessOrganizationListSchemaDefinition = z.object({
  organizations: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
});
export interface StaffAccessOrganizationListSchema extends Named<
  typeof staffAccessOrganizationListSchemaDefinition
> {}
export const staffAccessOrganizationListSchema: StaffAccessOrganizationListSchema =
  staffAccessOrganizationListSchemaDefinition;
export type StaffAccessOrganizationList = z.infer<typeof staffAccessOrganizationListSchema>;

/** The organization's id or slug. */
const staffAccessOrganizationParamsSchemaDefinition = z.object({
  organization: z.string().min(1).max(200),
});
export interface StaffAccessOrganizationParamsSchema extends Named<
  typeof staffAccessOrganizationParamsSchemaDefinition
> {}
export const staffAccessOrganizationParamsSchema: StaffAccessOrganizationParamsSchema =
  staffAccessOrganizationParamsSchemaDefinition;

const staffAccessUsageSchemaDefinition = z.object({
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  at: z.string(),
  codingAgentSessions: z.object({
    last7Days: z.number().int(),
    last30Days: z.number().int(),
    lastSessionAt: z.string().nullable(),
  }),
  gateway: z.object({ requests30Days: z.number().int(), spendUsd30Days: z.number() }),
  traces30Days: z.number().int(),
  apiKeys: z.array(
    z.object({ id: z.string(), name: z.string(), lastUsedAt: z.string().nullable() }),
  ),
  /** Members holding a live browser session now: use through the UI. */
  membersSignedIn: z.number().int(),
  /** How UI and API use are told apart in the figures above. */
  classification: z.string(),
});
export interface StaffAccessUsageSchema extends Named<typeof staffAccessUsageSchemaDefinition> {}
export const staffAccessUsageSchema: StaffAccessUsageSchema = staffAccessUsageSchemaDefinition;
export type StaffAccessUsage = z.infer<typeof staffAccessUsageSchema>;

const staffAccessQueueSummarySchemaDefinition = z.object({
  queues: z.array(
    z.object({
      name: z.string(),
      displayName: z.string(),
      pendingGroupCount: z.number(),
      blockedGroupCount: z.number(),
      activeGroupCount: z.number(),
      parkedGroupCount: z.number(),
      totalPendingJobs: z.number(),
      dlqCount: z.number(),
    }),
  ),
});
export interface StaffAccessQueueSummarySchema extends Named<
  typeof staffAccessQueueSummarySchemaDefinition
> {}
export const staffAccessQueueSummarySchema: StaffAccessQueueSummarySchema =
  staffAccessQueueSummarySchemaDefinition;
export type StaffAccessQueueSummary = z.infer<typeof staffAccessQueueSummarySchema>;

/** What an organization copy copies, in the order it runs: later kinds point at earlier ones. */
export const STAFF_ACCESS_COPY_KINDS = [
  "project",
  "evaluator",
  "monitor",
  "prompt",
  "dataset",
] as const;
export const staffAccessCopyKindSchema = z.enum(STAFF_ACCESS_COPY_KINDS);
export type StaffAccessCopyKind = z.infer<typeof staffAccessCopyKindSchema>;

/**
 * An organization copy (ADR-193, module ADR-002). The bearer is the target session's ops token;
 * the source session proves itself with its own ops token here, never by id alone.
 */
const staffAccessCopyBodySchemaDefinition = z
  .object({
    sourceOpsToken: z.string().min(1).max(300),
    /** Source project ids or slugs; every live project when left out. */
    projects: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export interface StaffAccessCopyBodySchema extends Named<
  typeof staffAccessCopyBodySchemaDefinition
> {}
export const staffAccessCopyBodySchema: StaffAccessCopyBodySchema =
  staffAccessCopyBodySchemaDefinition;
export type StaffAccessCopyBody = z.infer<typeof staffAccessCopyBodySchema>;

export const staffAccessCopyOutcomeSchema = z.enum([
  "planned",
  "copied",
  "already_copied",
  "skipped",
  "failed",
  "stopped",
]);
export type StaffAccessCopyOutcome = z.infer<typeof staffAccessCopyOutcomeSchema>;

const staffAccessCopyItemSchemaDefinition = z.object({
  kind: staffAccessCopyKindSchema,
  name: z.string(),
  sourceId: z.string(),
  sourceProjectId: z.string(),
  outcome: staffAccessCopyOutcomeSchema,
  targetId: z.string().nullable(),
  targetProjectId: z.string().nullable(),
  /** Why an item was skipped or failed: an error code or a short plain reason. */
  reason: z.string().nullable(),
});
export type StaffAccessCopyItem = z.infer<typeof staffAccessCopyItemSchemaDefinition>;

const staffAccessCopyOrganizationSchemaDefinition = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

const staffAccessCopyReportSchemaDefinition = z.object({
  source: staffAccessCopyOrganizationSchemaDefinition,
  target: staffAccessCopyOrganizationSchemaDefinition,
  dryRun: z.boolean(),
  /** Why the copy stopped before its last item (a session ended or was revoked); null otherwise. */
  stoppedBecause: z.string().nullable(),
  items: z.array(staffAccessCopyItemSchemaDefinition),
  totals: z.record(staffAccessCopyOutcomeSchema, z.number().int()),
});
export interface StaffAccessCopyReportSchema extends Named<
  typeof staffAccessCopyReportSchemaDefinition
> {}
export const staffAccessCopyReportSchema: StaffAccessCopyReportSchema =
  staffAccessCopyReportSchemaDefinition;
export type StaffAccessCopyReport = z.infer<typeof staffAccessCopyReportSchema>;
