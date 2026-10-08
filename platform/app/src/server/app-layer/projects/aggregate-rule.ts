/**
 * ADR-144 block D: the scope rule an aggregate project stores on
 * `Project.aggregateRule`. The rule is data. It never decides a read: the
 * reconciler (block E) resolves it to one shared project-reader grant per
 * member, and the reads go through those grants.
 *
 * Framework-free on purpose, so the new-project form and the server agree on
 * the shapes through one schema.
 */
import { z } from "zod";

/** The discriminator of `Project.aggregateRule`. */
export const AGGREGATE_RULE_KINDS = [
  "all-personal",
  "personal-by-department",
  "explicit",
] as const;

/** A named list of member projects: never empty, so "none" is never stored as `[]`. */
const projectIdsSchema = z.array(z.string().min(1)).min(1);

/**
 * The personal rules may also name projects to read on top of the personal
 * workspaces they resolve to: "every personal workspace, plus the support
 * bot". Optional, so a rule stored before the field existed still parses.
 */
export const aggregateRuleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("all-personal"),
      projectIds: projectIdsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("personal-by-department"),
      departmentId: z.string().min(1),
      projectIds: projectIdsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explicit"),
      projectIds: projectIdsSchema,
    })
    .strict(),
]);

export type AggregateRule = z.infer<typeof aggregateRuleSchema>;

/**
 * The rule as stored on `Project.aggregateRule`, or null when the column holds
 * nothing a rule can be read from. The column is JSON, so a row written by
 * hand, by an older shape or by a bug reads as "no rule" rather than being
 * cast into one: a reconciler that guessed at a malformed rule would attach or
 * revoke reads nobody asked for.
 */
export function aggregateRuleFromDb(value: unknown): AggregateRule | null {
  const parsed = aggregateRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Preselected on creation: every personal project in the organisation. */
export const AGGREGATE_DEFAULT_RULE = {
  kind: "all-personal",
} as const satisfies AggregateRule;
