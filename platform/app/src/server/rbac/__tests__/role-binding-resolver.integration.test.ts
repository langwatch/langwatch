/**
 * @vitest-environment node
 *
 * Integration tests for checkRoleBindingPermission against a real database.
 *
 * Covers the scenarios in specs/rbac/scoped-role-bindings.feature:
 * - Scope hierarchy (project → team → org)
 * - Group-expanded bindings
 * - Permission union across all matching bindings
 * - No fallback to TeamUser when no RoleBindings exist
 * - RoleBinding is authoritative: TeamUser is ignored even when both exist
 */
import {
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Project,
  type Team,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  checkRoleBindingPermission,
  type ScopeRef,
} from "../role-binding-resolver";

const NS = `rbac-int-${nanoid(6)}`;

// ============================================================================
// checkRoleBindingPermission() — scope hierarchy and group expansion
// ============================================================================

describe("checkRoleBindingPermission() scope hierarchy integration", () => {
  let org: Organization;
  let teamA: Team;
  let teamB: Team;
  let devProject: Project;
  let prodProject: Project;
  let alice: User;
  let bob: User;
  let carol: User;

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: { name: `${NS}-org`, slug: `${NS}-org` },
    });

    teamA = await prisma.team.create({
      data: { name: `${NS}-client-a`, slug: `${NS}-client-a`, organizationId: org.id },
    });
    teamB = await prisma.team.create({
      data: { name: `${NS}-client-b`, slug: `${NS}-client-b`, organizationId: org.id },
    });

    devProject = await prisma.project.create({
      data: {
        name: `${NS}-clienta-dev`,
        slug: `${NS}-clienta-dev`,
        apiKey: `${NS}-api-dev`,
        teamId: teamA.id,
        language: "python",
        framework: "openai",
      },
    });
    prodProject = await prisma.project.create({
      data: {
        name: `${NS}-clienta-prod`,
        slug: `${NS}-clienta-prod`,
        apiKey: `${NS}-api-prod`,
        teamId: teamA.id,
        language: "python",
        framework: "openai",
      },
    });

    alice = await prisma.user.create({
      data: { name: "Alice", email: `${NS}-alice@test.com` },
    });
    bob = await prisma.user.create({
      data: { name: "Bob", email: `${NS}-bob@test.com` },
    });
    carol = await prisma.user.create({
      data: { name: "Carol", email: `${NS}-carol@test.com` },
    });

    await prisma.organizationUser.createMany({
      data: [
        { userId: alice.id, organizationId: org.id, role: "MEMBER" },
        { userId: bob.id, organizationId: org.id, role: "MEMBER" },
        { userId: carol.id, organizationId: org.id, role: "MEMBER" },
      ],
    });
  });

  afterEach(async () => {
    await prisma.groupMembership.deleteMany({
      where: { group: { organizationId: org.id } },
    });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.teamUser.deleteMany({
      where: { teamId: { in: [teamA.id, teamB.id] } },
    });
  });

  afterAll(async () => {
    await prisma.groupMembership.deleteMany({
      where: { group: { organizationId: org.id } },
    });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.teamUser.deleteMany({
      where: { teamId: { in: [teamA.id, teamB.id] } },
    });
    await prisma.organizationUser.deleteMany({ where: { organizationId: org.id } });
    await prisma.project.deleteMany({ where: { teamId: { in: [teamA.id, teamB.id] } } });
    await prisma.team.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice.id, bob.id, carol.id] } },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Direct scope resolution
  // ──────────────────────────────────────────────────────────────────────────

  describe("when resolving scope hierarchy for direct bindings", () => {
    it("grants analytics:view via team-level binding when checking a project in that team", async () => {
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: alice.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamA.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(true);
    });

    it("unions permissions across scope levels — MEMBER at team grants datasets:manage even with VIEWER at project", async () => {
      // Union model: both bindings contribute; MEMBER at team covers datasets:manage
      await prisma.roleBinding.createMany({
        data: [
          {
            organizationId: org.id,
            userId: alice.id,
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamA.id,
          },
          {
            organizationId: org.id,
            userId: alice.id,
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: prodProject.id,
          },
        ],
      });

      const scope: ScopeRef = {
        type: "project",
        id: prodProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "datasets:manage",
      });

      // MEMBER (from team) grants datasets:manage via union
      expect(result).toBe(true);
    });

    it("does not grant access from a binding on a different project", async () => {
      // VIEWER at prodProject only — devProject is not an ancestor scope of prodProject
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: alice.id,
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: prodProject.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(false);
    });

    it("grants team:manage via org-level ADMIN binding when checking a project scope", async () => {
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: alice.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: org.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "team:manage",
      });

      expect(result).toBe(true);
    });

    it("denies access when user only has a binding on a different team", async () => {
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: carol.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamB.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: carol.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group-expanded bindings
  // ──────────────────────────────────────────────────────────────────────────

  describe("when resolving group-expanded bindings", () => {
    it("grants analytics:view to user via group VIEWER binding at project scope", async () => {
      const group = await prisma.group.create({
        data: {
          organizationId: org.id,
          name: `${NS}-clienta-dev-ro`,
          slug: `${NS}-clienta-dev-ro`,
        },
      });
      await prisma.groupMembership.create({
        data: { userId: bob.id, groupId: group.id },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: devProject.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: bob.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(true);
    });

    it("grants datasets:manage when user is in multiple groups and one grants MEMBER at the same scope", async () => {
      const groupViewer = await prisma.group.create({
        data: {
          organizationId: org.id,
          name: `${NS}-viewers`,
          slug: `${NS}-viewers`,
        },
      });
      const groupMember = await prisma.group.create({
        data: {
          organizationId: org.id,
          name: `${NS}-members`,
          slug: `${NS}-members`,
        },
      });
      await prisma.groupMembership.createMany({
        data: [
          { userId: bob.id, groupId: groupViewer.id },
          { userId: bob.id, groupId: groupMember.id },
        ],
      });
      await prisma.roleBinding.createMany({
        data: [
          {
            organizationId: org.id,
            groupId: groupViewer.id,
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamA.id,
          },
          {
            organizationId: org.id,
            groupId: groupMember.id,
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamA.id,
          },
        ],
      });

      const scope: ScopeRef = { type: "team", id: teamA.id };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: bob.id,
        organizationId: org.id,
        scope,
        permission: "datasets:manage",
      });

      // Union: MEMBER (groupMember) grants datasets:manage
      expect(result).toBe(true);
    });

    it("unions permissions from group bindings at different scope levels", async () => {
      // MEMBER via team-group + VIEWER via prod-group — union grants datasets:manage at prodProject
      const teamGroup = await prisma.group.create({
        data: {
          organizationId: org.id,
          name: `${NS}-team-group`,
          slug: `${NS}-team-group`,
        },
      });
      const prodGroup = await prisma.group.create({
        data: {
          organizationId: org.id,
          name: `${NS}-prod-ro`,
          slug: `${NS}-prod-ro`,
        },
      });
      await prisma.groupMembership.createMany({
        data: [
          { userId: bob.id, groupId: teamGroup.id },
          { userId: bob.id, groupId: prodGroup.id },
        ],
      });
      await prisma.roleBinding.createMany({
        data: [
          {
            organizationId: org.id,
            groupId: teamGroup.id,
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamA.id,
          },
          {
            organizationId: org.id,
            groupId: prodGroup.id,
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: prodProject.id,
          },
        ],
      });

      const scope: ScopeRef = {
        type: "project",
        id: prodProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: bob.id,
        organizationId: org.id,
        scope,
        permission: "datasets:manage",
      });

      // MEMBER (teamGroup at team scope) grants datasets:manage via union
      expect(result).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy TeamUser fallback
  // ──────────────────────────────────────────────────────────────────────────

  describe("when no RoleBinding exists for the user", () => {
    it("denies analytics:view even when a TeamUser record exists (no TeamUser fallback)", async () => {
      await prisma.teamUser.create({
        data: {
          userId: alice.id,
          teamId: teamA.id,
          role: TeamUserRole.MEMBER,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(false);
    });

    it("ignores TeamUser and uses RoleBinding only when both exist — denies team:manage for VIEWER binding despite ADMIN TeamUser", async () => {
      await prisma.teamUser.create({
        data: {
          userId: alice.id,
          teamId: teamA.id,
          role: TeamUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: alice.id,
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamA.id,
        },
      });

      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: alice.id,
        organizationId: org.id,
        scope,
        permission: "team:manage",
      });

      // RoleBinding (VIEWER) exists → TeamUser fallback is skipped.
      // VIEWER does not grant team:manage.
      expect(result).toBe(false);
    });

    it("denies access when there are no RoleBindings and no TeamUser", async () => {
      const scope: ScopeRef = {
        type: "project",
        id: devProject.id,
        teamId: teamA.id,
      };
      const result = await checkRoleBindingPermission({
        prisma,
        userId: carol.id,
        organizationId: org.id,
        scope,
        permission: "analytics:view",
      });

      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// checkRoleBindingPermission() — permission mapping
// ============================================================================

describe("checkRoleBindingPermission() integration", () => {
  let org: Organization;
  let team: Team;
  let project: Project;
  let alice: User;

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: { name: `${NS}-perm-org`, slug: `${NS}-perm-org` },
    });
    team = await prisma.team.create({
      data: {
        name: `${NS}-perm-team`,
        slug: `${NS}-perm-team`,
        organizationId: org.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: `${NS}-perm-proj`,
        slug: `${NS}-perm-proj`,
        apiKey: `${NS}-perm-api`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    alice = await prisma.user.create({
      data: { name: "AlicePerm", email: `${NS}-aliceperm@test.com` },
    });
    await prisma.organizationUser.create({
      data: { userId: alice.id, organizationId: org.id, role: "MEMBER" },
    });
  });

  afterEach(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: org.id } });
    await prisma.project.deleteMany({ where: { teamId: team.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: alice.id } });
  });

  const teamScope = (): ScopeRef => ({ type: "team", id: team.id });

  it("grants team:manage to Admin binding", async () => {
    await prisma.roleBinding.create({
      data: {
        organizationId: org.id,
        userId: alice.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    });

    const result = await checkRoleBindingPermission({
      prisma,
      userId: alice.id,
      organizationId: org.id,
      scope: teamScope(),
      permission: "team:manage",
    });

    expect(result).toBe(true);
  });

  it("denies team:manage to Member binding", async () => {
    await prisma.roleBinding.create({
      data: {
        organizationId: org.id,
        userId: alice.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    });

    const result = await checkRoleBindingPermission({
      prisma,
      userId: alice.id,
      organizationId: org.id,
      scope: teamScope(),
      permission: "team:manage",
    });

    expect(result).toBe(false);
  });

  it("grants analytics:view to Viewer binding", async () => {
    await prisma.roleBinding.create({
      data: {
        organizationId: org.id,
        userId: alice.id,
        role: TeamUserRole.VIEWER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    });

    const result = await checkRoleBindingPermission({
      prisma,
      userId: alice.id,
      organizationId: org.id,
      scope: teamScope(),
      permission: "analytics:view",
    });

    expect(result).toBe(true);
  });

  it("denies datasets:manage to Viewer binding", async () => {
    await prisma.roleBinding.create({
      data: {
        organizationId: org.id,
        userId: alice.id,
        role: TeamUserRole.VIEWER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    });

    const result = await checkRoleBindingPermission({
      prisma,
      userId: alice.id,
      organizationId: org.id,
      scope: teamScope(),
      permission: "datasets:manage",
    });

    expect(result).toBe(false);
  });

  it("returns false when user has no binding", async () => {
    const result = await checkRoleBindingPermission({
      prisma,
      userId: alice.id,
      organizationId: org.id,
      scope: teamScope(),
      permission: "analytics:view",
    });

    expect(result).toBe(false);
  });
});
