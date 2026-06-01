import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rbacMocks = vi.hoisted(() => ({
  hasOrganizationPermission: vi.fn(),
  hasTeamPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
}));

vi.mock("~/server/api/rbac", () => rbacMocks);

const planMocks = vi.hoisted(() => ({
  getActivePlan: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: { getActivePlan: planMocks.getActivePlan },
  }),
}));

import {
  assertCanWriteRetentionScope,
  assertRetentionPlanForScope,
  requiredRetentionWritePermission,
} from "../dataRetentionPolicy.authz";

const session = { user: { id: "user_member" } } as any;
const prisma = {} as any;
const ctx = { prisma, session };

describe("requiredRetentionWritePermission", () => {
  it("maps each tier to the permission the read snapshot advertises", () => {
    expect(requiredRetentionWritePermission("ORGANIZATION")).toBe(
      "organization:manage",
    );
    expect(requiredRetentionWritePermission("TEAM")).toBe("team:manage");
    // PROJECT uses project:update (NOT project:manage) so a team MEMBER, who
    // the snapshot shows their project as writable, can actually save.
    expect(requiredRetentionWritePermission("PROJECT")).toBe("project:update");
  });
});

describe("assertCanWriteRetentionScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a PROJECT scope and a caller who holds project:update", () => {
    // Regression: members hold project:update but not project:manage. The
    // earlier code reused the model-provider helper (project:manage) and
    // rejected a save the read snapshot had already offered.
    it("authorizes the write using project:update", async () => {
      rbacMocks.hasProjectPermission.mockResolvedValue(true);

      await expect(
        assertCanWriteRetentionScope(ctx, {
          scopeType: "PROJECT",
          scopeId: "project_a",
        }),
      ).resolves.toBeUndefined();

      expect(rbacMocks.hasProjectPermission).toHaveBeenCalledWith(
        ctx,
        "project_a",
        "project:update",
      );
    });
  });

  describe("given a PROJECT scope and a caller who lacks project:update", () => {
    it("throws FORBIDDEN with data-retention wording", async () => {
      rbacMocks.hasProjectPermission.mockResolvedValue(false);

      try {
        await assertCanWriteRetentionScope(ctx, {
          scopeType: "PROJECT",
          scopeId: "project_a",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCError);
        const err = e as TRPCError;
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("project:update");
        expect(err.message).toContain("data retention");
        // No leftover model-provider wording.
        expect(err.message).not.toContain("model provider");
      }
    });
  });

  describe("given a TEAM scope", () => {
    it("checks team:manage", async () => {
      rbacMocks.hasTeamPermission.mockResolvedValue(true);

      await expect(
        assertCanWriteRetentionScope(ctx, {
          scopeType: "TEAM",
          scopeId: "team_a",
        }),
      ).resolves.toBeUndefined();

      expect(rbacMocks.hasTeamPermission).toHaveBeenCalledWith(
        ctx,
        "team_a",
        "team:manage",
      );
    });
  });

  describe("given an ORGANIZATION scope", () => {
    it("checks organization:manage", async () => {
      rbacMocks.hasOrganizationPermission.mockResolvedValue(true);

      await expect(
        assertCanWriteRetentionScope(ctx, {
          scopeType: "ORGANIZATION",
          scopeId: "org_1",
        }),
      ).resolves.toBeUndefined();

      expect(rbacMocks.hasOrganizationPermission).toHaveBeenCalledWith(
        { prisma, session },
        "org_1",
        "organization:manage",
      );
    });
  });

  describe("given no session", () => {
    it("throws FORBIDDEN without consulting RBAC helpers", async () => {
      await expect(
        assertCanWriteRetentionScope(
          { prisma, session: null },
          { scopeType: "PROJECT", scopeId: "project_a" },
        ),
      ).rejects.toBeInstanceOf(TRPCError);

      expect(rbacMocks.hasProjectPermission).not.toHaveBeenCalled();
    });
  });
});

describe("assertRetentionPlanForScope", () => {
  const prismaScopeMock = {
    organization: { findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
  } as any;
  const ctxScope = { prisma: prismaScopeMock, session };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaScopeMock.organization.findUnique.mockReset();
    prismaScopeMock.team.findUnique.mockReset();
    prismaScopeMock.project.findUnique.mockReset();
  });

  describe("regression: free-plan owning org rejects the mutation even when a paid projectId is supplied", () => {
    /**
     * Before the fix, `setForScope` and `removeForScope` plan-gated against
     * the caller-supplied `input.projectId`, not `input.scope`. A caller who
     * could write a scope in a free org and also had a paid project elsewhere
     * could thread the paid project's id alongside the free-org scope and
     * silently bypass the paid-tier gate. The gate now ties to the scope's
     * owning org.
     */
    it("throws FORBIDDEN when the scope's owning organization is on a free plan", async () => {
      // Scope target: an organization that is on the free plan.
      prismaScopeMock.organization.findUnique.mockResolvedValue({
        id: "org_free",
      });
      planMocks.getActivePlan.mockResolvedValue({ free: true });

      await expect(
        assertRetentionPlanForScope(ctxScope, {
          scopeType: "ORGANIZATION",
          scopeId: "org_free",
        }),
      ).rejects.toMatchObject({
        name: "TRPCError",
        code: "FORBIDDEN",
      });

      expect(planMocks.getActivePlan).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_free" }),
      );
    });
  });

  describe("given a TEAM scope", () => {
    it("resolves the team's organization and gates against that org's plan", async () => {
      prismaScopeMock.team.findUnique.mockResolvedValue({
        organizationId: "org_paid",
      });
      planMocks.getActivePlan.mockResolvedValue({ free: false });

      await expect(
        assertRetentionPlanForScope(ctxScope, {
          scopeType: "TEAM",
          scopeId: "team_a",
        }),
      ).resolves.toBeUndefined();

      expect(planMocks.getActivePlan).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_paid" }),
      );
    });
  });

  describe("given a PROJECT scope", () => {
    it("resolves the project's team's organization and gates that org's plan", async () => {
      prismaScopeMock.project.findUnique.mockResolvedValue({
        team: { organizationId: "org_paid" },
      });
      planMocks.getActivePlan.mockResolvedValue({ free: false });

      await expect(
        assertRetentionPlanForScope(ctxScope, {
          scopeType: "PROJECT",
          scopeId: "project_a",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the scope target does not exist", () => {
    it("throws NOT_FOUND", async () => {
      prismaScopeMock.organization.findUnique.mockResolvedValue(null);

      await expect(
        assertRetentionPlanForScope(ctxScope, {
          scopeType: "ORGANIZATION",
          scopeId: "org_missing",
        }),
      ).rejects.toMatchObject({
        name: "TRPCError",
        code: "NOT_FOUND",
      });
    });
  });
});
