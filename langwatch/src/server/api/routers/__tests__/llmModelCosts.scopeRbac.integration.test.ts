/**
 * @vitest-environment node
 *
 * Scope-aware RBAC for the custom LLM model-cost write path. Real Postgres
 * test container, no mocks. The multi-scope `createOrUpdate` lets a caller
 * write a cost row at a scope they manage (organization / team / project).
 *
 * Contract under test:
 *   - createOrUpdate authorizes project:manage (or the tier equivalent) on the
 *     DESTINATION scope, AND — on the update branch — on the row's CURRENT
 *     scope. Without the second check a caller who manages only their own
 *     scope could pass another tenant's row id and re-anchor it into their org.
 *
 * Spec: specs/model-providers/model-cost-scoping.feature
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import type { Permission } from "../../rbac";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("llmModelCosts — scope-aware RBAC", () => {
  const ns = `llmcostrbac-${nanoid(8)}`;
  const ORG_A = `org-a-${ns}`;
  const ORG_B = `org-b-${ns}`;
  const TEAM_A = `team-a-${ns}`;
  const TEAM_B = `team-b-${ns}`;
  const PROJECT_A = `proj-a-${ns}`;
  const PROJECT_B = `proj-b-${ns}`;
  let seq = 0;

  async function seedOrg(
    orgId: string,
    teamId: string,
    projectId: string,
  ): Promise<void> {
    await prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId },
    });
    await prisma.team.create({
      data: { id: teamId, name: teamId, slug: teamId, organizationId: orgId },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: projectId,
        slug: projectId,
        teamId,
        language: "en",
        framework: "openai",
        apiKey: `key-${projectId}`,
      },
    });
  }

  /**
   * Seed an org MEMBER whose only grant is a CUSTOM RoleBinding carrying
   * `perms` at `scope` — never an OrganizationUser.ADMIN, so a pass can only
   * come from the explicit grant, not a role short-circuit.
   */
  async function seedUser(
    orgId: string,
    perms: Permission[],
    scope: { scopeType: RoleBindingScopeType; scopeId: string },
  ): Promise<Caller> {
    const uid = `usr-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: {
        organizationId: orgId,
        userId: uid,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const roleId = `crole-${uid}`;
    await prisma.customRole.create({
      data: {
        id: roleId,
        organizationId: orgId,
        name: roleId,
        permissions: perms,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: orgId,
        userId: uid,
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      },
    });
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: uid, email, name: uid },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  async function seedCostRow(
    orgId: string,
    projectId: string,
    model: string,
  ): Promise<string> {
    const id = `llmcost-${ns}-${seq++}`;
    await prisma.customLLMModelCost.create({
      data: {
        id,
        organizationId: orgId,
        scopeType: "PROJECT",
        scopeId: projectId,
        projectId,
        model,
        regex: model,
        inputCostPerToken: 0.001,
        outputCostPerToken: 0.002,
      },
    });
    return id;
  }

  beforeAll(async () => {
    await startTestContainers();
    await seedOrg(ORG_A, TEAM_A, PROJECT_A);
    await seedOrg(ORG_B, TEAM_B, PROJECT_B);
  }, 60_000);

  afterAll(async () => {
    for (const orgId of [ORG_A, ORG_B]) {
      await prisma.customLLMModelCost.deleteMany({
        where: { organizationId: orgId },
      });
      await prisma.roleBinding.deleteMany({ where: { organizationId: orgId } });
      await prisma.customRole.deleteMany({ where: { organizationId: orgId } });
      await prisma.project.deleteMany({
        where: { team: { organizationId: orgId } },
      });
      await prisma.team.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationUser.deleteMany({
        where: { organizationId: orgId },
      });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await stopTestContainers();
  });

  const PROJECT = RoleBindingScopeType.PROJECT;

  describe("given an existing cost row owned by another tenant", () => {
    /** @scenario createOrUpdate rejects re-anchoring a cost row the caller does not own */
    it("forbids updating org A's cost row from an org B project-manager", async () => {
      const rowA = await seedCostRow(ORG_A, PROJECT_A, "gpt-5-mini");
      // Attacker legitimately manages PROJECT_B in ORG_B, so the destination
      // scope check passes — only the row's current-scope check stops them.
      const attacker = await seedUser(ORG_B, ["project:manage"], {
        scopeType: PROJECT,
        scopeId: PROJECT_B,
      });

      await expect(
        attacker.llmModelCost.createOrUpdate({
          id: rowA,
          projectId: PROJECT_B,
          scopeType: "PROJECT",
          scopeId: PROJECT_B,
          model: "hijacked",
          regex: "hijacked",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The row must be untouched: same org, same scope, original model.
      const after = await prisma.customLLMModelCost.findUniqueOrThrow({
        where: { id: rowA },
      });
      expect(after.organizationId).toBe(ORG_A);
      expect(after.scopeId).toBe(PROJECT_A);
      expect(after.model).toBe("gpt-5-mini");
    });
  });

  describe("given the caller manages the row's own scope", () => {
    /** @scenario createOrUpdate updates a cost row when the caller manages its current scope */
    it("allows a project-manager in the row's org to update it", async () => {
      const rowA = await seedCostRow(ORG_A, PROJECT_A, "gpt-5-mini");
      const owner = await seedUser(ORG_A, ["project:manage"], {
        scopeType: PROJECT,
        scopeId: PROJECT_A,
      });

      const res = await owner.llmModelCost.createOrUpdate({
        id: rowA,
        projectId: PROJECT_A,
        scopeType: "PROJECT",
        scopeId: PROJECT_A,
        model: "gpt-5-mini",
        regex: "gpt-5-mini-v2",
      });

      expect(res.id).toBe(rowA);
      expect(res.regex).toBe("gpt-5-mini-v2");
    });
  });

  describe("given a half-filled custom base rate", () => {
    it("rejects inputCostPerToken with no outputCostPerToken", async () => {
      // resolveCustomTierRates treats any set rate as a full registry override,
      // so a row with only input set silently prices output at $0. An authorized
      // caller must still be rejected at the input boundary, not just by the UI.
      const owner = await seedUser(ORG_A, ["project:manage"], {
        scopeType: PROJECT,
        scopeId: PROJECT_A,
      });

      await expect(
        owner.llmModelCost.createOrUpdate({
          projectId: PROJECT_A,
          scopeType: "PROJECT",
          scopeId: PROJECT_A,
          model: "gpt-5-mini",
          inputCostPerToken: 0.000001,
          regex: "gpt-5-mini",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a cache-only rate row (no input/output base rates)", async () => {
      // A cache-only row also overrides the registry entirely, zeroing the unset
      // base tiers — so any rate set requires the input+output pair.
      const owner = await seedUser(ORG_A, ["project:manage"], {
        scopeType: PROJECT,
        scopeId: PROJECT_A,
      });

      await expect(
        owner.llmModelCost.createOrUpdate({
          projectId: PROJECT_A,
          scopeType: "PROJECT",
          scopeId: PROJECT_A,
          model: "gpt-5-mini",
          cacheReadCostPerToken: 0.0000001,
          regex: "gpt-5-mini",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a negative rate", async () => {
      const owner = await seedUser(ORG_A, ["project:manage"], {
        scopeType: PROJECT,
        scopeId: PROJECT_A,
      });

      await expect(
        owner.llmModelCost.createOrUpdate({
          projectId: PROJECT_A,
          scopeType: "PROJECT",
          scopeId: PROJECT_A,
          model: "gpt-5-mini",
          inputCostPerToken: -0.01,
          outputCostPerToken: 0.02,
          regex: "gpt-5-mini",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
