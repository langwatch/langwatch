/**
 * ADR-177 block D: the scope rule an aggregate project stores on
 * `Project.aggregateRule`. The rule is data and never decides a read:
 * governance's reconciler resolves it to one shared project-reader grant per member.
 */
import { z } from "zod";

/** The discriminator of `Project.aggregateRule`. */
export const AGGREGATE_RULE_KINDS = ["all-personal", "personal-by-department", "explicit"] as const;

export const aggregateRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all-personal") }).strict(),
  z.object({ kind: z.literal("personal-by-department"), departmentId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("explicit"), projectIds: z.array(z.string().min(1)).min(1) }).strict(),
]);
export type AggregateRule = z.infer<typeof aggregateRuleSchema>;

/** Preselected on creation: every personal project in the organisation. */
export const AGGREGATE_DEFAULT_RULE = { kind: "all-personal" } as const satisfies AggregateRule;

/** A project an aggregate may read, as the new-project form lists it. */
export const aggregateMemberCandidateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    /** `Project.isPersonal`, the flag the all-personal rule resolves by. */
    isPersonal: z.boolean(),
    /** The personal workspace's owner; null for a project that is not personal. */
    owner: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
  })
  .strict();
export type AggregateMemberCandidate = z.infer<typeof aggregateMemberCandidateSchema>;

/** An aggregate project as the reconciler reads it: where it lives, and its rule. */
export const storedAggregateProjectSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    /** The project or its team is archived; an archived aggregate reads nothing. */
    archived: z.boolean(),
    /** Null when the stored column does not parse as a rule. */
    rule: aggregateRuleSchema.nullable(),
  })
  .strict();
export type StoredAggregateProject = z.infer<typeof storedAggregateProjectSchema>;

/** A live aggregate and its organisation, for the sweep over every organisation. */
export const liveAggregateSchema = z
  .object({ id: z.string().min(1), organizationId: z.string().min(1) })
  .strict();
export type LiveAggregate = z.infer<typeof liveAggregateSchema>;

/**
 * Main's reconcile result, kept as the wire shape (bodies superset). The
 * reconciler runs after the answer (M8487-MEMBERS), so the rule's selected
 * members arrive as `pending` and main's four lists answer empty.
 */
export const aggregateRuleMembersSchema = z
  .object({
    attached: z.array(z.string()),
    revoked: z.array(z.string()),
    unchanged: z.array(z.string()),
    failed: z.array(z.string()),
    pending: z.array(z.string()),
  })
  .strict();
export type AggregateRuleMembers = z.infer<typeof aggregateRuleMembersSchema>;
