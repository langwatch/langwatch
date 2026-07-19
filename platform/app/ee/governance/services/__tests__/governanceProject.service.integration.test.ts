/**
 * ensureHiddenGovernanceProject helper — integration tests.
 *
 * Sergey commit 2b-i (e2c30961a) shipped the single central helper that
 * lazily mints the hidden per-org Governance Project on first need
 * (typically the first IngestionSource mint). This test exercises the
 * real lazy-ensure machinery against Postgres + asserts the locked
 * invariants:
 *
 *   1. First-mint creates a single Project with kind = "internal_governance"
 *      attached to the org's oldest team.
 *   2. Idempotency: a second call returns the same Project (no duplicate
 *      rows under sequential calls).
 *   3. Idempotency under concurrent races: N parallel callers produce
 *      exactly one Project (the slug-based re-check at line 82 of
 *      governanceProject.service.ts collapses any race).
 *   4. Throws when the org has no team (fresh-admin invariant — a real
 *      governance entity mint must be preceded by team creation).
 *   5. Cross-org tenancy isolation: orgA's helper never returns orgB's
 *      Project, even if both orgs minted theirs at similar times.
 *   6. Composes with the Layer-1 filter (Alexis commit 94426716e):
 *      a Project minted via this helper is FILTERED OUT of
 *      `PrismaOrganizationRepository.getAllForUser` — proving the two
 *      workstreams compose correctly into the unified-substrate invariant
 *      that user-visible Project surfaces never leak governance routing
 *      artifacts.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *     (lazy-ensure on first IngestionSource mint, internal-only invariant)
 *   - specs/ai-gateway/governance/ui-contract.feature
 *     (hidden Gov Project never leaks to user surfaces)
 *   - specs/ai-gateway/governance/compliance-baseline.feature
 *     (RBAC via project-membership; no privileged data leaks)
 *
 * Pairs with:
 *   - organization.prisma.repository.governance-filter.integration.test.ts
 *     (Layer-1 filter test, Alexis 94426716e — seeds projects manually)
 *   - eventLogDurability.integration.test.ts
 *     (event_log non-repudiation, Andre f25d713ab)
 *   - parseOtlpBody.test.ts
 *     (parser-equivalence contract, Andre 38106f768)
 */
import { type Organization } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";

import {
  PROJECT_KIND,
  ensureHiddenGovernanceProject,
} from "../governanceProject.service";

describe("ensureHiddenGovernanceProject — lazy-ensure invariants for the hidden Governance Project", () => {
  const testNamespace = `gov-helper-${nanoid(8)}`;
  let primaryOrg: Organization;
  let secondaryOrg: Organization;
  let teamlessOrg: Organization;
  let primaryUser: { id: string };
  const createdProjectIds = new Set<string>();
  const createdTeamIds = new Set<string>();

  beforeAll(async () => {
    primaryOrg = await prisma.organization.create({
      data: {
        name: `Primary Org ${testNamespace}`,
        slug: `primary-org-${testNamespace}`,
      },
    });
    const primaryTeam = await prisma.team.create({
      data: {
        name: `Primary Team ${testNamespace}`,
        slug: `primary-team-${testNamespace}`,
        organizationId: primaryOrg.id,
      },
    });
    createdTeamIds.add(primaryTeam.id);

    secondaryOrg = await prisma.organization.create({
      data: {
        name: `Secondary Org ${testNamespace}`,
        slug: `secondary-org-${testNamespace}`,
      },
    });
    const secondaryTeam = await prisma.team.create({
      data: {
        name: `Secondary Team ${testNamespace}`,
        slug: `secondary-team-${testNamespace}`,
        organizationId: secondaryOrg.id,
      },
    });
    createdTeamIds.add(secondaryTeam.id);

    // org with no team — exercises fresh-admin invariant
    teamlessOrg = await prisma.organization.create({
      data: {
        name: `Teamless Org ${testNamespace}`,
        slug: `teamless-org-${testNamespace}`,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: `gov-helper-test-${testNamespace}@example.com`,
        name: `Gov Helper Test User ${testNamespace}`,
      },
    });
    primaryUser = { id: user.id };
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: primaryOrg.id,
        role: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    // Best-effort cleanup. Order matters: projects → teams → org users → orgs → user.
    // Cleanup must scope on organizationId/userId_organizationId/id to satisfy
    // dbOrganizationIdProtection middleware on Team / OrganizationUser.
    if (createdProjectIds.size > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: Array.from(createdProjectIds) } },
      });
    }
    for (const orgId of [primaryOrg?.id, secondaryOrg?.id, teamlessOrg?.id].filter(Boolean) as string[]) {
      await prisma.organizationUser
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => undefined);
      await prisma.team
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => undefined);
      await prisma.organization
        .delete({ where: { id: orgId } })
        .catch(() => undefined);
    }
    if (primaryUser?.id) {
      await prisma.user.delete({ where: { id: primaryUser.id } }).catch(() => undefined);
    }
  });

  describe("given an org has no Governance Project yet", () => {
    it("creates exactly one Project with kind=internal_governance attached to the org's oldest team", async () => {
      const before = await prisma.project.findMany({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId: primaryOrg.id },
        },
      });
      expect(before).toHaveLength(0);

      const project = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      createdProjectIds.add(project.id);

      expect(project.kind).toBe("internal_governance");
      expect(project.archivedAt).toBeNull();

      const team = await prisma.team.findUnique({ where: { id: project.teamId } });
      expect(team?.organizationId).toBe(primaryOrg.id);

      const after = await prisma.project.findMany({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId: primaryOrg.id },
        },
      });
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(project.id);
    });
  });

  describe("given a Governance Project already exists for the org", () => {
    it("returns the same Project (idempotent — no duplicate row)", async () => {
      const first = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      const second = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      const third = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);

      expect(second.id).toBe(first.id);
      expect(third.id).toBe(first.id);

      const total = await prisma.project.count({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId: primaryOrg.id },
        },
      });
      expect(total).toBe(1);
    });
  });

  describe("given multiple concurrent first-mint callers race for the same org", () => {
    it("collapses to exactly one Governance Project (slug-uniqueness re-check wins)", async () => {
      const concurrent = 5;
      const results = await Promise.all(
        Array.from({ length: concurrent }, () =>
          ensureHiddenGovernanceProject(prisma, secondaryOrg.id),
        ),
      );

      results.forEach((p) => createdProjectIds.add(p.id));

      const ids = new Set(results.map((p) => p.id));
      expect(ids.size).toBe(1);

      const total = await prisma.project.count({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId: secondaryOrg.id },
        },
      });
      expect(total).toBe(1);
    });
  });

  describe("given an org with no team (fresh-admin pre-team state)", () => {
    it("throws — a real governance entity mint cannot precede team creation", async () => {
      await expect(
        ensureHiddenGovernanceProject(prisma, teamlessOrg.id),
      ).rejects.toThrow(/has no team/);
    });
  });

  describe("given two orgs each with a Governance Project (cross-tenant isolation)", () => {
    it("returns the calling org's Project, never the other org's", async () => {
      const primaryProject = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      const secondaryProject = await ensureHiddenGovernanceProject(prisma, secondaryOrg.id);

      expect(primaryProject.id).not.toBe(secondaryProject.id);

      const primaryTeam = await prisma.team.findUnique({
        where: { id: primaryProject.teamId },
      });
      const secondaryTeam = await prisma.team.findUnique({
        where: { id: secondaryProject.teamId },
      });
      expect(primaryTeam?.organizationId).toBe(primaryOrg.id);
      expect(secondaryTeam?.organizationId).toBe(secondaryOrg.id);
    });
  });

  describe("composition with PrismaOrganizationRepository.getAllForUser (Alexis Layer-1 filter)", () => {
    it("never includes the helper-minted Governance Project in the user-visible org/team/project tree", async () => {
      const governanceProject = await ensureHiddenGovernanceProject(
        prisma,
        primaryOrg.id,
      );
      createdProjectIds.add(governanceProject.id);

      const repository = new PrismaOrganizationRepository(prisma);
      const orgs = await repository.getAllForUser({
        userId: primaryUser.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      const orgUnderTest = orgs.find((o) => o.id === primaryOrg.id);
      expect(orgUnderTest).toBeDefined();

      const visibleProjects = orgUnderTest!.teams.flatMap((t) => t.projects);
      const visibleProjectIds = visibleProjects.map((p) => p.id);
      const visibleProjectKinds = visibleProjects.map((p) => p.kind);

      expect(visibleProjectIds).not.toContain(governanceProject.id);
      expect(visibleProjectKinds).not.toContain(PROJECT_KIND.INTERNAL_GOVERNANCE);
    });
  });

  describe("schema invariants on the helper-minted Project", () => {
    it("traceSharingEnabled is false (governance data must not leak via public-share links)", async () => {
      const project = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      expect(project.traceSharingEnabled).toBe(false);
    });

    it("slug is org-scoped + stable (governance-${organizationId})", async () => {
      const project = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
      expect(project.slug).toBe(`governance-${primaryOrg.id}`);
    });
  });
});
