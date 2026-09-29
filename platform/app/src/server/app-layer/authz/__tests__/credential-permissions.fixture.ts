import { vi } from "vitest";
import {
  type Grant,
  type OrganizationUserRole,
  type Prisma,
  PrismaClient,
  type Role,
} from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";

export const ORG = "org-credential";
export const TEAM = "team-credential";
export const PROJECT = "project-credential";
export const USER = "user-credential";
export const KEY = "key-credential";
export const GROUP = "group-credential";

export type GrantRow = Pick<
  Grant,
  | "id"
  | "organizationId"
  | "principalType"
  | "principalId"
  | "roleKey"
  | "legacyRole"
  | "source"
  | "scopeType"
  | "scopeId"
  | "token"
  | "permission"
  | "resourceKind"
  | "projectId"
  | "createdByUserId"
  | "expiresAt"
  | "maxViews"
  | "occurredAt"
  | "revokedAt"
>;
type RoleRow = Pick<
  Role,
  "id" | "organizationId" | "kind" | "permissions" | "deletedAt"
>;

export function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "grant-credential",
    organizationId: ORG,
    principalType: "USER",
    principalId: USER,
    roleKey: "member",
    legacyRole: null,
    source: "grants-service",
    scopeType: "TEAM",
    scopeId: TEAM,
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: new Date("2025-01-01T00:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

export function role(overrides: Partial<RoleRow> = {}): RoleRow {
  return {
    id: "role-credential",
    organizationId: ORG,
    kind: "custom",
    permissions: ["traces:view"],
    deletedAt: null,
    ...overrides,
  };
}

function matches(value: unknown, condition: unknown): boolean {
  if (condition === void 0) return true;
  if (condition === null || typeof condition !== "object")
    return value === condition;
  if ("in" in condition && Array.isArray(condition.in))
    return condition.in.includes(value);
  if ("not" in condition) return !matches(value, condition.not);
  throw new Error("Unsupported fixture query filter");
}

/** Real engine and repository, with mutable database facts and query-aware delegates. */
export function credentialFixture() {
  const grants: GrantRow[] = [];
  const roles: RoleRow[] = [];
  const memberships = new Map<
    string,
    { role: OrganizationUserRole; disabledAt: Date | null }
  >([[USER, { role: "MEMBER", disabledAt: null }]]);
  const groups: Array<{
    userId: string;
    groupId: string;
    organizationId: string;
  }> = [];
  const projects = [{ id: PROJECT, teamId: TEAM }];
  const key: { userId: string | null } = { userId: USER };
  const legacyRead = vi.fn(() => {
    throw new Error("Legacy authorization was read");
  });
  const migrationRead = vi.fn(() => {
    throw new Error("Migration state was read during authorization");
  });
  const grantFindMany = vi.fn(
    async ({ where }: Prisma.GrantFindManyArgs = {}) =>
      grants.filter(
        (row) =>
          matches(row.organizationId, where?.organizationId) &&
          matches(row.principalType, where?.principalType) &&
          matches(row.principalId, where?.principalId) &&
          matches(row.scopeType, where?.scopeType) &&
          matches(row.scopeId, where?.scopeId) &&
          matches(row.roleKey, where?.roleKey) &&
          matches(row.revokedAt, where?.revokedAt),
      ),
  );

  const prisma = Object.assign(
    new PrismaClient({
      adapter: createPrismaPgAdapter(
        "postgresql://localhost/unused_credential_fixture",
      ),
    }),
    {
      grant: {
        findMany: grantFindMany,
        findFirst: vi.fn(
          async (args: Prisma.GrantFindFirstArgs = {}) =>
            (await grantFindMany(args))[0] ?? null,
        ),
      },
      role: {
        findMany: vi.fn(async ({ where }: Prisma.RoleFindManyArgs = {}) =>
          roles.filter(
            (row) =>
              matches(row.id, where?.id) &&
              matches(row.organizationId, where?.organizationId) &&
              matches(row.kind, where?.kind) &&
              matches(row.deletedAt, where?.deletedAt),
          ),
        ),
      },
      organizationUser: {
        findFirst: vi.fn(
          async ({ where }: Prisma.OrganizationUserFindFirstArgs = {}) => {
            const found = [...memberships].find(
              ([userId, member]) =>
                matches(userId, where?.userId) &&
                matches(ORG, where?.organizationId) &&
                matches(member.disabledAt, where?.disabledAt),
            );
            return found ? { userId: found[0], ...found[1] } : null;
          },
        ),
      },
      groupMembership: {
        findMany: vi.fn(
          async ({ where }: Prisma.GroupMembershipFindManyArgs = {}) =>
            groups.filter(
              (row) =>
                matches(row.userId, where?.userId) &&
                matches(row.organizationId, where?.group?.organizationId),
            ),
        ),
      },
      project: {
        findUnique: vi.fn(async ({ where }: Prisma.ProjectFindUniqueArgs) => {
          const found = projects.find(({ id }) => id === where.id);
          return found
            ? { ...found, team: { id: found.teamId, organizationId: ORG } }
            : null;
        }),
        findMany: vi.fn(async () => projects),
      },
      team: {
        findMany: vi.fn(async () =>
          [...new Set(projects.map(({ teamId }) => teamId))].map((id) => ({
            id,
          })),
        ),
        findUnique: vi.fn(async ({ where }: Prisma.TeamFindUniqueArgs) =>
          where.id === TEAM ? { id: TEAM, organizationId: ORG } : null,
        ),
      },
      apiKey: { findUnique: vi.fn(async () => key) },
      roleBinding: { findMany: legacyRead, count: legacyRead },
      teamUser: { findMany: legacyRead, findFirst: legacyRead },
      customRole: { findMany: legacyRead, findFirst: legacyRead },
      systemMigrationTenantState: { findUnique: migrationRead },
    },
  );
  return {
    prisma,
    grants,
    roles,
    memberships,
    groups,
    projects,
    key,
    legacyRead,
    migrationRead,
    grantFindMany,
  };
}
