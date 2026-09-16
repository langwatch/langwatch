import type { ProjectIdentity } from "@langwatch/project-contract";

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
