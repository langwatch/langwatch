import type { ProjectIdentity } from "@langwatch/project-contract";

/**
 * The columns a project identity is, named once.
 *
 * Two reads answer with an identity — one project and a batch — and a column
 * present in one and missing from the other is a runtime `undefined` the type
 * checker cannot see, because Prisma types a `select` from its literal.
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

export type ProjectIdentityRow = {
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
