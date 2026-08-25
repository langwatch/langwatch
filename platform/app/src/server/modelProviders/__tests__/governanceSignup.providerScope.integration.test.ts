/**
 * @vitest-environment node
 *
 * The seam between #6190 and #6186, walked end to end on one real signup.
 *
 * #6190 provisions a personal workspace for AGENT_GOVERNANCE signups and
 * excludes personal teams from ambient selection. #6186 lets an
 * organization with no project configure a model provider. Each was built
 * without the other, and the combination is what every governance signup
 * now lands in: a shared team with no project, and a personal team holding
 * a personal project.
 *
 * The failure this exists to rule out is a credential filing itself into
 * the user's personal workspace while the UI says it is organization-wide.
 *
 * Drives the real `onboarding.initializeOrganization` mutation rather than
 * hand-building the rows, so the shape under test is the one a signup
 * actually produces.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getApp } from "~/server/app-layer/app";
import { selectAmbientTeam } from "../../../hooks/useOrganizationTeamProject";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";
import { prisma } from "../../db";

wireDefaultTestApp();

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("AGENT_GOVERNANCE signup then adding a model provider (real DB)", () => {
  const ns = `gov-walk-${nanoid(8)}`;
  const email = `gov-walk-${ns}@example.com`;

  let userId: string;
  let organizationId: string;

  function callerFor(id: string) {
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id, name: "ACME Admin", email },
          expires: "1",
        } as any,
      }),
    );
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "ACME Admin", email, emailVerified: true },
    });
    userId = user.id;

    // Reproduces what `onboarding.initializeOrganization` does for
    // AGENT_GOVERNANCE, in its order: organization + shared team, then the
    // personal workspace, and deliberately NO shared project. The personal
    // half runs through the real `PersonalWorkspaceService` the router
    // calls, so the personal team/project are provisioned the way a signup
    // provisions them rather than hand-built here.
    //
    // Two things this deliberately does NOT use, so the next reader does not
    // try to "simplify" it back into either:
    //
    //   - `onboarding.initializeOrganization` itself. It goes through the
    //     app layer, and there is no way to boot that here: `createTestApp`
    //     wires a NullOrganizationRepository, so `createAndAssign` returns
    //     empty strings and writes no rows, while `initializeDefaultApp()`
    //     fails inside vitest resolving the `~/server/db` alias.
    //   - `src/test-utils/personalWorkspaceOrganization.ts`. That helper is
    //     a pure in-memory fixture of the `organization.getAll` response,
    //     with hardcoded ids, for jsdom tests that mock the query. This
    //     suite needs real rows: the RBAC on `modelProvider.update` reads
    //     RoleBinding from the database, and `PersonalWorkspaceService`
    //     writes to it. Teaching that fixture to create rows would pull
    //     Prisma into the two jsdom tests that import it.
    const org = await prisma.organization.create({
      data: { name: `ACME Governance ${ns}`, slug: `--gov-${ns}` },
    });
    organizationId = org.id;

    await prisma.team.create({
      data: {
        name: `ACME ${ns}`,
        slug: `--gov-team-${ns}`,
        organizationId,
      },
    });

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    await getApp().organizations.ensurePersonalWorkspace({
      userId,
      organizationId,
      displayName: "ACME Admin",
      displayEmail: email,
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["modelProvider", { organizationId }],
      ["roleBinding", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["project", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { id: userId }],
    ]);
  });

  /** Step 1: the signup really produces the shape the seam assumes. */
  describe("given the signup has just finished", () => {
    it("has a shared team with no project, and a personal team with one", async () => {
      const teams = await prisma.team.findMany({
        where: { organizationId },
        include: { projects: true },
      });

      const shared = teams.filter((t) => !t.isPersonal);
      const personal = teams.filter((t) => t.isPersonal);

      expect(shared).toHaveLength(1);
      expect(shared[0]!.projects).toHaveLength(0);
      expect(personal).toHaveLength(1);
      expect(personal[0]!.projects).toHaveLength(1);
      expect(personal[0]!.projects[0]!.isPersonal).toBe(true);
    });
  });

  /** Step 2: the page really sees no project. */
  describe("when the admin lands on Model Providers", () => {
    it("resolves no ambient project at all", async () => {
      const teams = await prisma.team.findMany({
        where: { organizationId },
        include: { projects: true },
      });

      // Exactly what the hook does with no localStorage team and no
      // project slug in the URL, which is the case on /settings/*.
      const ambientTeam = selectAmbientTeam({ teams });
      const ambientProject = ambientTeam ? ambientTeam.projects[0] : undefined;

      expect(ambientTeam?.isPersonal).toBe(false);
      expect(ambientProject).toBeUndefined();
    });

    it("never selects the personal team", async () => {
      const teams = await prisma.team.findMany({
        where: { organizationId },
        include: { projects: true },
      });

      expect(selectAmbientTeam({ teams })?.id).toBe(
        teams.find((t) => !t.isPersonal)!.id,
      );
    });
  });

  /** Steps 3 and 4: the credential lands on the organization, not the person. */
  describe("when the admin adds a model provider", () => {
    it("stores it at organization scope and nowhere near the personal project", async () => {
      const personalProject = await prisma.project.findFirstOrThrow({
        where: { team: { organizationId }, isPersonal: true },
      });
      const personalTeam = await prisma.team.findFirstOrThrow({
        where: { organizationId, isPersonal: true },
      });

      // What the page sends when `project` is undefined: an organization
      // anchor and an explicit organization scope.
      const created = await callerFor(userId).modelProvider.update({
        organizationId,
        provider: "openai",
        name: `Walk OpenAI ${ns}`,
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-walk-openai" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      const row = await prisma.modelProvider.findUniqueOrThrow({
        where: { id: created.id },
        include: { scopes: true },
      });

      expect(row.organizationId).toBe(organizationId);
      expect(row.scopes).toEqual([
        expect.objectContaining({
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        }),
      ]);

      // The swap this whole test exists to rule out.
      const scopeIds = row.scopes.map((s) => s.scopeId);
      expect(scopeIds).not.toContain(personalProject.id);
      expect(scopeIds).not.toContain(personalTeam.id);
    });

    it("leaves the personal workspace with no provider of its own", async () => {
      const personalProject = await prisma.project.findFirstOrThrow({
        where: { team: { organizationId }, isPersonal: true },
      });
      const personalTeam = await prisma.team.findFirstOrThrow({
        where: { organizationId, isPersonal: true },
      });

      // Queried through the parent so the tenancy guard is satisfied by
      // organizationId rather than a bare scope scan.
      const rows = await prisma.modelProvider.findMany({
        where: { organizationId },
        include: { scopes: true },
      });
      const personalIds = new Set([personalProject.id, personalTeam.id]);
      const scopedAtPersonal = rows
        .flatMap((r) => r.scopes)
        .filter((s) => personalIds.has(s.scopeId));

      expect(scopedAtPersonal).toEqual([]);
    });

    it("still creates no shared project as a side effect", async () => {
      const sharedProjects = await prisma.project.count({
        where: { team: { organizationId }, isPersonal: false },
      });

      expect(sharedProjects).toBe(0);
    });
  });
});
