/**
 * @vitest-environment node
 *
 * Integration coverage for the VK guardrail-attach write path on
 * `api.virtualKeys.update`. Real Postgres test container, no mocks.
 *
 * Validates the server-side invariants behind the attach UI:
 *   1. Project-scope guard — a VK can only attach guardrails from its own
 *      project; a guardrail from another project is rejected BAD_REQUEST
 *      `guardrail_project_mismatch` and the VK config is left unchanged.
 *   2. Happy path — attaching a guardrail from the VK's project persists
 *      `config.guardrailAttachments` as `{direction, guardrailIds[]}`
 *      tuples and emits a `gateway.virtual_key.guardrail_attached`
 *      AuditLog row targeted at the VK.
 *   3. Perm gate — a caller holding `virtualKeys:manage` but NOT
 *      `gatewayGuardrails:attach` on the VK's project is rejected
 *      FORBIDDEN `missing_perm:gatewayGuardrails:attach`. The denial must
 *      fire on the guardrail-attach gate, not the upstream
 *      `virtualKeys:manage` org gate — otherwise the test would pass for
 *      the wrong reason.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
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
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

describe("virtualKeys.update — guardrail attach", () => {
  const ns = `vkgr-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const TEAM_ID = `team-${ns}`;
  const USER_ID = `usr-${ns}`;
  const USER_EMAIL = `${ns}@example.com`;
  const DEMO_PROJECT_ID = `proj-demo-${ns}`;
  const OTHER_PROJECT_ID = `proj-other-${ns}`;
  const DEMO_GUARDRAIL_ID = `gr-demo-${ns}`;
  const OTHER_GUARDRAIL_ID = `gr-other-${ns}`;
  const VK_ID = `vk-${ns}`;
  // Second principal: holds virtualKeys:manage (passes the org gate) but
  // NOT gatewayGuardrails:attach (fails the project gate). Modelled with
  // an ORG-scoped CUSTOM role since no built-in role grants that combo —
  // org ADMIN cascades attach, MEMBER lacks virtualKeys:manage.
  const NOATTACH_USER_ID = `usr-noattach-${ns}`;
  const NOATTACH_USER_EMAIL = `noattach-${ns}@example.com`;
  const NOATTACH_ROLE_ID = `crole-${ns}`;

  let caller: ReturnType<typeof appRouter.createCaller>;
  let noAttachCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${ns}`, slug: `org-${ns}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: USER_EMAIL, name: "VKGR Tester" },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    // ORG-scoped ADMIN RoleBinding grants virtualKeys:manage (org) +
    // cascades gatewayGuardrails:attach to every project in the org.
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${ns}`,
        slug: `team-${ns}`,
        organizationId: ORG_ID,
        members: { create: { userId: USER_ID, role: TeamUserRole.ADMIN } },
      },
    });
    for (const [pid, slug] of [
      [DEMO_PROJECT_ID, `demo-${ns}`],
      [OTHER_PROJECT_ID, `other-${ns}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id: pid,
          name: pid,
          slug,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${slug}`,
        },
      });
    }
    // One guardrail per project, each backed by a project-local evaluator.
    for (const [pid, grId, evId] of [
      [DEMO_PROJECT_ID, DEMO_GUARDRAIL_ID, `ev-demo-${ns}`],
      [OTHER_PROJECT_ID, OTHER_GUARDRAIL_ID, `ev-other-${ns}`],
    ] as const) {
      await prisma.evaluator.create({
        data: {
          id: evId,
          projectId: pid,
          name: evId,
          slug: evId,
          type: "evaluator",
          config: {},
        },
      });
      await prisma.gatewayGuardrail.create({
        data: {
          id: grId,
          projectId: pid,
          name: grId,
          evaluatorId: evId,
          direction: "PRE",
          failureMode: "FAIL_CLOSED",
        },
      });
    }
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "vk-strict",
        hashedSecret: `hash-${ns}`,
        displayPrefix: "vk-lw-01HZX9N",
        createdById: USER_ID,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: DEMO_PROJECT_ID }] },
      },
    });

    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: USER_ID, email: USER_EMAIL, name: "VKGR Tester" },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as any,
      }),
    );

    // Denial principal: a CUSTOM role granting virtualKeys:manage +
    // gatewayGuardrails:view but NOT gatewayGuardrails:attach, bound at
    // ORGANIZATION scope. OrganizationUser.role=MEMBER so the org-role
    // fast path never grants attach on its own.
    await prisma.user.create({
      data: {
        id: NOATTACH_USER_ID,
        email: NOATTACH_USER_EMAIL,
        name: "No Attach Tester",
      },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: NOATTACH_USER_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.customRole.create({
      data: {
        id: NOATTACH_ROLE_ID,
        organizationId: ORG_ID,
        name: `manage-no-attach-${ns}`,
        permissions: ["virtualKeys:manage", "gatewayGuardrails:view"],
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: NOATTACH_USER_ID,
        role: TeamUserRole.CUSTOM,
        customRoleId: NOATTACH_ROLE_ID,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });

    noAttachCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: {
            id: NOATTACH_USER_ID,
            email: NOATTACH_USER_EMAIL,
            name: "No Attach Tester",
          },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as any,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.gatewayGuardrail.deleteMany({
      where: { projectId: { in: [DEMO_PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await prisma.monitor.deleteMany({
      where: { projectId: { in: [DEMO_PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await prisma.evaluator.deleteMany({
      where: { projectId: { in: [DEMO_PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, NOATTACH_USER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  describe("when attaching a guardrail from a different project", () => {
    /** @scenario VK cannot attach a guardrail from a different project */
    it("rejects with guardrail_project_mismatch and leaves config unchanged", async () => {
      await expect(
        caller.virtualKeys.update({
          organizationId: ORG_ID,
          id: VK_ID,
          config: {
            guardrailAttachments: [
              { direction: "pre", guardrailIds: [OTHER_GUARDRAIL_ID] },
            ],
          },
        }),
      ).rejects.toThrow(/guardrail_project_mismatch/);

      const vk = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: VK_ID },
      });
      expect(
        (vk.config as { guardrailAttachments?: unknown[] }).guardrailAttachments ??
          [],
      ).toEqual([]);
    });
  });

  describe("when attaching a guardrail from the VK's own project", () => {
    /** @scenario VK attaches existing GatewayGuardrail rows by reference */
    it("persists the attachment tuple and emits a guardrail_attached audit row", async () => {
      const updated = await caller.virtualKeys.update({
        organizationId: ORG_ID,
        id: VK_ID,
        config: {
          guardrailAttachments: [
            { direction: "pre", guardrailIds: [DEMO_GUARDRAIL_ID] },
          ],
        },
      });

      expect(
        (updated.config as { guardrailAttachments?: unknown[] })
          .guardrailAttachments,
      ).toEqual([{ direction: "pre", guardrailIds: [DEMO_GUARDRAIL_ID] }]);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_ID,
          action: "gateway.virtual_key.guardrail_attached",
          targetId: VK_ID,
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.after).toMatchObject({
        direction: "pre",
        guardrailId: DEMO_GUARDRAIL_ID,
      });
    });
  });

  describe("when the caller lacks gatewayGuardrails:attach on the project", () => {
    /** @scenario gatewayGuardrails:attach is required on the VK side to wire a guardrail to a VK */
    it("rejects with missing_perm:gatewayGuardrails:attach", async () => {
      await expect(
        noAttachCaller.virtualKeys.update({
          organizationId: ORG_ID,
          id: VK_ID,
          config: {
            guardrailAttachments: [
              { direction: "pre", guardrailIds: [DEMO_GUARDRAIL_ID] },
            ],
          },
        }),
      ).rejects.toThrow(/missing_perm:gatewayGuardrails:attach/);
    });

    // Guards against a false-green: the denial must come from the
    // guardrail-attach project gate, NOT the upstream virtualKeys:manage
    // org gate. If the CUSTOM role failed to grant virtualKeys:manage the
    // call would 401 on the org gate and the test above would still pass
    // for the wrong reason. Prove the caller clears the org gate by
    // letting it run an update with NO guardrail attachments.
    it("clears the virtualKeys:manage org gate (attach gate is the only blocker)", async () => {
      const updated = await noAttachCaller.virtualKeys.update({
        organizationId: ORG_ID,
        id: VK_ID,
        description: "noattach caller cleared the org gate",
      });
      expect(updated.id).toBe(VK_ID);
    });
  });
});
