/**
 * The ops functions (ADR-202, amendment 2026-11-25): named investigation reads a staff session
 * calls. Outputs carry ids, counts, states, codes and times only; every list is a page.
 * Spec: modules/staff-access/specs/staff-access-functions.feature
 */
import { z } from "zod";

import {
  countsByCode,
  entry,
  isoTime,
  pageInput,
  rangeInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";
import { STAFF_ACCESS_ACTIVITY_FUNCTIONS } from "./staff-access-functions-activity.ts";
import { STAFF_ACCESS_BILLING_FUNCTIONS } from "./staff-access-functions-billing.ts";
import { STAFF_ACCESS_LANGY_FUNCTIONS } from "./staff-access-functions-langy.ts";
import { STAFF_ACCESS_PEOPLE_FUNCTIONS } from "./staff-access-functions-people.ts";
import { STAFF_ACCESS_PLATFORM_FUNCTIONS } from "./staff-access-functions-platform.ts";
import { STAFF_ACCESS_TELEMETRY_FUNCTIONS } from "./staff-access-functions-telemetry.ts";

export {
  STAFF_ACCESS_TELEMETRY_FUNCTIONS,
  STAFF_ACCESS_LANGY_FUNCTIONS,
  STAFF_ACCESS_PEOPLE_FUNCTIONS,
  STAFF_ACCESS_ACTIVITY_FUNCTIONS,
  STAFF_ACCESS_PLATFORM_FUNCTIONS,
  STAFF_ACCESS_BILLING_FUNCTIONS,
};
export {
  STAFF_ACCESS_FUNCTION_LIMITS,
  staffAccessFunctionScopeSchema,
  staffAccessPageSchema,
  type StaffAccessFunctionScope,
  type StaffAccessPageSchema,
} from "./staff-access-function-shapes.ts";

const STAFF_ACCESS_CORE_FUNCTIONS = {
  "orgs.find": entry({
    title: "Find organizations by name, slug or id",
    scope: "lookup",
    answers: "Which organization a name, slug or id points at, so a session can be asked for it.",
    input: z.object({ query: z.string().trim().min(1).max(200), ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z.object({ id: z.string(), slug: z.string(), name: z.string(), createdAt: isoTime }).strict(),
    ),
  }),
  "user.sign_in": entry({
    title: "One account's sign-in state, by exact email",
    scope: "lookup",
    personal: true,
    answers: "Whether a person who cannot sign in has an account, how they sign in, and if locked.",
    input: z.object({ email: z.email().max(320) }).strict(),
    output: z
      .object({
        exists: z.boolean(),
        userId: z.string().nullable(),
        createdAt: isoTime.nullable(),
        lastSignInAt: isoTime.nullable(),
        methods: z.array(z.string()),
        passkeys: z.number().int(),
        twoStepEnabled: z.boolean(),
        locked: z.boolean(),
        deactivated: z.boolean(),
      })
      .strict(),
  }),
  "org.snapshot": entry({
    title: "Plan, member and project counts, creation and flags",
    scope: "org",
    answers: "What the organization is set up with before reading anything further.",
    input: z.object({}).strict(),
    output: z
      .object({
        organizationId: z.string(),
        createdAt: isoTime,
        plan: z.string(),
        membersCount: z.number().int(),
        pendingInvitesCount: z.number().int(),
        teamsCount: z.number().int(),
        projectIds: z.array(z.string()),
        flagsOn: z.array(z.string()),
      })
      .strict(),
  }),
  "org.ingestion_health": entry({
    title: "Traces per project over a range, last trace time, plan-limit refusals",
    scope: "org",
    answers:
      "Whether traces are arriving, since when they stopped, and if the plan limit refused them.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          projectId: z.string(),
          traces: z.number().int(),
          lastTraceAt: isoTime.nullable(),
          planLimitRefusals: z.number().int(),
        })
        .strict(),
    ),
  }),
  "org.trace_presence": entry({
    title: "Whether one trace id is stored in one project",
    scope: "org",
    answers: "Whether a trace a customer cannot find was stored, and when it arrived.",
    input: z
      .object({ projectId: z.string().min(1).max(200), traceId: z.string().min(1).max(200) })
      .strict(),
    output: z
      .object({
        projectId: z.string(),
        traceId: z.string(),
        stored: z.boolean(),
        firstSeenAt: isoTime.nullable(),
        lastSeenAt: isoTime.nullable(),
        spanCount: z.number().int(),
      })
      .strict(),
  }),
  "org.evaluator_errors": entry({
    title: "Online evaluator runs and failures by error code, who created it, and if it paused",
    scope: "org",
    answers: "Which online evaluator fails, how often, with which codes, and whether it paused.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          projectId: z.string(),
          evaluatorId: z.string(),
          evaluatorType: z.string(),
          runs: z.number().int(),
          errors: z.number().int(),
          skipped: z.number().int(),
          errorsByCode: countsByCode,
          lastErrorAt: isoTime.nullable(),
          createdByUserId: z.string().nullable(),
          disabledAt: isoTime.nullable(),
          /** `error_rate` when it paused itself, `manual` when someone turned it off. */
          disabledReasonCode: z.enum(["error_rate", "manual"]).nullable(),
        })
        .strict(),
    ),
  }),
  "org.usage_limits": entry({
    title: "Plan limits beside what the organization used",
    scope: "org",
    answers: "Whether the organization hit a plan limit, and which one.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          plan: z.string(),
          limit: z.string(),
          cap: z.number().nullable(),
          used: z.number().nullable(),
        })
        .strict(),
    ),
  }),
  "org.api_keys": entry({
    title: "API keys by id, kind, scope and use times",
    scope: "org",
    answers: "Which keys exist and still call, when one expired or was revoked.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          id: z.string(),
          kind: z.string(),
          projectId: z.string().nullable(),
          createdAt: isoTime,
          lastUsedAt: isoTime.nullable(),
          expiresAt: isoTime.nullable(),
          revokedAt: isoTime.nullable(),
          permissions: z.array(z.string()),
        })
        .strict(),
    ),
  }),
  "queues.tenant": entry({
    title: "The organization's queue groups: pending, blocked, parked, dead-lettered",
    scope: "org",
    answers: "Whether the organization's jobs are stuck, and in which queue.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          queue: z.string(),
          pendingGroups: z.number().int(),
          blockedGroups: z.number().int(),
          activeGroups: z.number().int(),
          parkedGroups: z.number().int(),
          dlqGroups: z.number().int(),
          pendingJobs: z.number().int(),
          oldestPendingAt: isoTime.nullable(),
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;

export const STAFF_ACCESS_FUNCTIONS = {
  ...STAFF_ACCESS_CORE_FUNCTIONS,
  ...STAFF_ACCESS_TELEMETRY_FUNCTIONS,
  ...STAFF_ACCESS_LANGY_FUNCTIONS,
  ...STAFF_ACCESS_PEOPLE_FUNCTIONS,
  ...STAFF_ACCESS_ACTIVITY_FUNCTIONS,
  ...STAFF_ACCESS_PLATFORM_FUNCTIONS,
  ...STAFF_ACCESS_BILLING_FUNCTIONS,
} as const satisfies Record<string, StaffAccessFunctionEntry>;

export type StaffAccessFunctionName = keyof typeof STAFF_ACCESS_FUNCTIONS;
export type StaffAccessFunctionInput<Name extends StaffAccessFunctionName> = z.infer<
  (typeof STAFF_ACCESS_FUNCTIONS)[Name]["input"]
>;
export type StaffAccessFunctionOutput<Name extends StaffAccessFunctionName> = z.infer<
  (typeof STAFF_ACCESS_FUNCTIONS)[Name]["output"]
>;

export const STAFF_ACCESS_FUNCTION_NAMES = Object.keys(
  STAFF_ACCESS_FUNCTIONS,
).toSorted() as StaffAccessFunctionName[];

export function isStaffAccessFunctionName(name: string): name is StaffAccessFunctionName {
  return Object.hasOwn(STAFF_ACCESS_FUNCTIONS, name);
}
