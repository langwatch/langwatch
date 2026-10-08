/**
 * ADR-175: the scope rule an aggregate project stores on `Project.aggregateRule`.
 * The rule is data and never decides a read: the reconciler resolves it to one
 * shared project-reader grant per member, and reads go through those grants.
 */
import { z } from "zod";

/** The discriminator of `Project.aggregateRule`. */
export const AGGREGATE_RULE_KINDS = ["all-personal", "personal-by-department", "explicit"] as const;

export const aggregateRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all-personal") }).strict(),
  z
    .object({
      kind: z.literal("personal-by-department"),
      departmentId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit"),
      projectIds: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);
export type AggregateRule = z.infer<typeof aggregateRuleSchema>;

/** Preselected on creation: every personal project in the organisation. */
export const AGGREGATE_DEFAULT_RULE = {
  kind: "all-personal",
} as const satisfies AggregateRule;

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
