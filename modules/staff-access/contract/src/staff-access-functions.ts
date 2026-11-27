/**
 * The ops functions (ADR-202, amendment 2026-11-25): named investigation reads a staff session
 * calls. Outputs carry ids, counts, states, codes and times only; every list is a page.
 * Spec: modules/staff-access/specs/staff-access-functions.feature
 */
import { z } from "zod";

export const STAFF_ACCESS_FUNCTION_LIMITS = {
  /** How many functions one request may name. */
  maxPerRequest: 12,
  maxRangeDays: 31,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

/** `lookup` finds an id, `platform` spans organizations, `org` reads the approved org. */
export const staffAccessFunctionScopeSchema = z.enum(["lookup", "platform", "org"]);
export type StaffAccessFunctionScope = z.infer<typeof staffAccessFunctionScopeSchema>;

const isoTime = z.iso.datetime({ offset: true });
const pageInput = {
  limit: z.number().int().min(1).max(STAFF_ACCESS_FUNCTION_LIMITS.maxPageSize).optional(),
  cursor: z.string().min(1).max(500).optional(),
};
const rangeInput = {
  /** Start of the range; at most 31 days before `until`. */
  since: isoTime,
  /** End of the range; now when left out. */
  until: isoTime.optional(),
};

/** A page of `item`: never a silent cut, `truncated` says more exist and `nextCursor` reads on. */
export type StaffAccessPageSchema<Item extends z.ZodType> = z.ZodObject<
  {
    items: z.ZodArray<Item>;
    total: z.ZodNumber;
    truncated: z.ZodBoolean;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strict
>;

export function staffAccessPageSchema<Item extends z.ZodType>(
  item: Item,
): StaffAccessPageSchema<Item> {
  return z
    .object({
      items: z.array(item),
      total: z.number().int(),
      truncated: z.boolean(),
      nextCursor: z.string().nullable(),
    })
    .strict();
}

const countsByCode = z.record(z.string(), z.number().int());

type Entry = Readonly<{
  title: string;
  scope: StaffAccessFunctionScope;
  /** The investigation this read answers. */
  answers: string;
  /** Answers about one person, from one exact input. */
  personal?: true;
  input: z.ZodObject;
  output: z.ZodType;
}>;

const entry = <E extends Entry>(declared: E): E => declared;

export const STAFF_ACCESS_FUNCTIONS = {
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
    title: "Online evaluator runs and failures by error code",
    scope: "org",
    answers: "Which online evaluator fails, how often, and with which error codes.",
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
} as const satisfies Record<string, Entry>;

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
