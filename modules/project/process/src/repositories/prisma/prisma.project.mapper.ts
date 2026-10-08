import {
  aggregateRuleSchema,
  type AggregateRule,
  type ProjectIdentity,
} from "@langwatch/project-contract";

/** What an aggregate's stored rule column reads as: a rule, or nothing usable. */
type StoredAggregateRule =
  | { readonly outcome: "rule"; readonly rule: AggregateRule }
  | { readonly outcome: "unreadable" };

/**
 * ADR-175: an aggregate's stored rule, read through the schema and never a
 * cast. A column that does not parse is no rule, so a damaged row resolves to
 * no members rather than to whatever the JSON happens to hold.
 */
export function aggregateRuleFromDb(stored: unknown): StoredAggregateRule {
  const parsed = aggregateRuleSchema.safeParse(stored);
  return parsed.success ? { outcome: "rule", rule: parsed.data } : { outcome: "unreadable" };
}

/**
 * The columns a project identity is, named once — two reads share this (one
 * project, one batch), and a column present in one but missing from the
 * other is a runtime `undefined` Prisma's literal-typed `select` can't catch.
 */
export const PROJECT_IDENTITY_SELECT = {
  id: true,
  name: true,
  slug: true,
  teamId: true,
  isPersonal: true,
  ownerUserId: true,
  team: { select: { organizationId: true } },
} as const;

type ProjectIdentityRow = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  team: { organizationId: string };
};

export function mapProjectIdentityRow(row: ProjectIdentityRow): ProjectIdentity {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    teamId: row.teamId,
    organizationId: row.team.organizationId,
    isPersonal: row.isPersonal,
    ownerUserId: row.ownerUserId,
  };
}
