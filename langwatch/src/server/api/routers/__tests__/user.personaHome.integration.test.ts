/**
 * @vitest-environment node
 *
 * Integration coverage for the persona-home customization tRPC surface:
 *
 *   - api.user.userProjects        — Persona-2 enrichment data source
 *                                     (lists user's app-kind projects in org,
 *                                      excludes hidden internal_governance)
 *   - api.user.setLastHomePath     — persists / clears User.lastHomePath
 *   - api.user.homePagePickerState — picker UI state (pin + first project)
 *   - api.governance.resolveHome   — honors the persisted pin (isOverride=true)
 *
 * Real Postgres test container; no mocks at the storage edges.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { createTestApp } from "../../../app-layer/presets";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

describe("user.persona-home customization integration", () => {
  const ns = `phome-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const USER_ID = `usr-${ns}`;
  const USER_EMAIL = `${ns}@example.com`;

  let caller: ReturnType<typeof appRouter.createCaller>;
  let appProjectAlphaId: string;
  let appProjectBetaId: string;

  beforeAll(async () => {
    await startTestContainers();

    // Init the app-layer with a deterministic FREE-plan provider so the
    // resolveHome path that calls UsageStatsService.getUsageStats has a
    // working dependency. Persona-detection only needs `isEnterprise =
    // false` for this test's user, which the FREE plan gives us.
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async (): Promise<PlanInfo> => FREE_PLAN,
      }),
    });

    await prisma.organization.create({
      data: { id: ORG_ID, name: "PHome Org", slug: `phome-${ns}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: USER_EMAIL, name: "PHome Tester" },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    const team = await prisma.team.create({
      data: {
        id: `team-${ns}`,
        name: "PHome Team",
        slug: `phome-team-${ns}`,
        organizationId: ORG_ID,
        members: {
          create: {
            userId: USER_ID,
            role: TeamUserRole.MEMBER,
          },
        },
      },
    });
    // Two app-kind projects (one updated more recently than the other) +
    // one hidden internal_governance project that MUST be excluded from
    // the userProjects response.
    const alpha = await prisma.project.create({
      data: {
        id: `proj-alpha-${ns}`,
        name: "Alpha Service",
        slug: `alpha-${ns}`,
        apiKey: `apk-alpha-${ns}`,
        teamId: team.id,
        language: "ts",
        framework: "node",
        kind: "application",
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      },
    });
    appProjectAlphaId = alpha.id;
    const beta = await prisma.project.create({
      data: {
        id: `proj-beta-${ns}`,
        name: "Beta Pipeline",
        slug: `beta-${ns}`,
        apiKey: `apk-beta-${ns}`,
        teamId: team.id,
        language: "ts",
        framework: "node",
        kind: "application",
        updatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    });
    appProjectBetaId = beta.id;
    await prisma.project.create({
      data: {
        id: `proj-hidden-${ns}`,
        name: "Internal Governance",
        slug: `hidden-${ns}`,
        apiKey: `apk-hidden-${ns}`,
        teamId: team.id,
        language: "ts",
        framework: "node",
        kind: "internal_governance",
      },
    });

    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: {
            id: USER_ID,
            email: USER_EMAIL,
            name: "PHome Tester",
          },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as any,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await resetApp();
    await stopTestContainers();
  }, 60_000);

  describe("user.userProjects", () => {
    it("returns the user's application projects sorted by updatedAt DESC", async () => {
      const rows = await caller.user.userProjects({ organizationId: ORG_ID });
      expect(rows.map((r) => r.id)).toEqual([
        appProjectBetaId,
        appProjectAlphaId,
      ]);
      expect(rows[0]?.name).toBe("Beta Pipeline");
      expect(rows[0]?.teamName).toBe("PHome Team");
    });

    it("excludes hidden internal_governance projects from the response", async () => {
      const rows = await caller.user.userProjects({ organizationId: ORG_ID });
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.slug.startsWith("hidden-"))).toBeUndefined();
    });

    it("respects the limit parameter", async () => {
      const rows = await caller.user.userProjects({
        organizationId: ORG_ID,
        limit: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(appProjectBetaId);
    });
  });

  describe("user.setLastHomePath + homePagePickerState round-trip", () => {
    it("starts with no pin (auto-detection)", async () => {
      const state = await caller.user.homePagePickerState({
        organizationId: ORG_ID,
      });
      expect(state.lastHomePath).toBeNull();
      expect(state.firstProjectSlug).toMatch(/^(alpha|beta)-/);
    });

    it("persists a pin via setLastHomePath and reads it back", async () => {
      const result = await caller.user.setLastHomePath({ path: "/me" });
      expect(result).toEqual({ ok: true });
      const state = await caller.user.homePagePickerState({
        organizationId: ORG_ID,
      });
      expect(state.lastHomePath).toBe("/me");
    });

    it("clears the pin when given null path", async () => {
      await caller.user.setLastHomePath({ path: "/me" });
      const cleared = await caller.user.setLastHomePath({ path: null });
      expect(cleared).toEqual({ ok: true });
      const state = await caller.user.homePagePickerState({
        organizationId: ORG_ID,
      });
      expect(state.lastHomePath).toBeNull();
    });

    it("rejects non-/-prefixed paths", async () => {
      await expect(
        caller.user.setLastHomePath({ path: "no-leading-slash" } as any),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("governance.resolveHome honors the persisted user pin", () => {
    it("returns the pinned destination with isOverride=true", async () => {
      await caller.user.setLastHomePath({ path: "/me" });
      const resolved = await caller.governance.resolveHome({
        organizationId: ORG_ID,
      });
      expect(resolved.destination).toBe("/me");
      expect(resolved.isOverride).toBe(true);
    });

    it("falls through to auto-detection once the pin is cleared", async () => {
      await caller.user.setLastHomePath({ path: "/me" });
      await caller.user.setLastHomePath({ path: null });
      const resolved = await caller.governance.resolveHome({
        organizationId: ORG_ID,
      });
      expect(resolved.isOverride).toBe(false);
      // No personal VK, has app projects → persona project_only,
      // destination /<firstProjectSlug>/messages.
      expect(resolved.persona).toBe("project_only");
      expect(resolved.destination).toMatch(/^\/(alpha|beta)-.*\/messages$/);
    });
  });
});
