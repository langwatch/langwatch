/**
 * @vitest-environment node
 *
 * Integration coverage for tRPC `user.requestBudgetIncrease` — the
 * mutation that powers the `/me/budget/request` page submit AND
 * closes the loop on the gateway 402 → CLI `langwatch request-increase`
 * → `/me/budget/request` deep-link path. The mutation:
 *   1. resolves the org's first ADMIN by email
 *   2. fires `sendBudgetIncreaseRequestEmail` with the spend context
 *   3. returns `{ ok: true, sentTo: <admin email> }`
 *
 * The email layer (`sendEmail`) is mocked so the test doesn't actually
 * call SES/SendGrid — but the rest of the path (Prisma org/admin
 * lookup, RoleBinding permission check, email-template rendering,
 * tRPC error mapping) runs against a real Postgres test container.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

vi.mock("../../../mailer/emailSender", () => ({
  sendEmail: vi.fn(),
}));
import { sendEmail } from "../../../mailer/emailSender";

describe("user.requestBudgetIncrease integration", () => {
  const ns = `bri-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const ORG_NO_ADMIN_ID = `org-noadm-${ns}`;
  const ADMIN_USER_ID = `usr-adm-${ns}`;
  const ADMIN_EMAIL = `${ns}-admin@example.com`;
  const REQUESTER_USER_ID = `usr-req-${ns}`;
  const REQUESTER_EMAIL = `${ns}-req@example.com`;

  let caller: ReturnType<typeof appRouter.createCaller>;
  let noAdminCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: "Acme Corp", slug: `acme-${ns}` },
        {
          id: ORG_NO_ADMIN_ID,
          name: "No-Admin Corp",
          slug: `noadm-${ns}`,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: "The Admin" },
        { id: REQUESTER_USER_ID, email: REQUESTER_EMAIL, name: "The Requester" },
      ],
    });
    // Admin org: ADMIN + MEMBER
    await prisma.organizationUser.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: ADMIN_USER_ID,
          role: OrganizationUserRole.ADMIN,
        },
        {
          organizationId: ORG_ID,
          userId: REQUESTER_USER_ID,
          role: OrganizationUserRole.MEMBER,
        },
        // No-admin org: only the requester (no ADMIN role-member)
        {
          organizationId: ORG_NO_ADMIN_ID,
          userId: REQUESTER_USER_ID,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });
    // RoleBindings for permission middleware
    await prisma.roleBinding.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: REQUESTER_USER_ID,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_ID,
        },
        {
          organizationId: ORG_NO_ADMIN_ID,
          userId: REQUESTER_USER_ID,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_NO_ADMIN_ID,
        },
      ],
    });

    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: {
            id: REQUESTER_USER_ID,
            email: REQUESTER_EMAIL,
            name: "The Requester",
          },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as any,
      }),
    );
    noAdminCaller = caller;
  }, 60_000);

  afterAll(async () => {
    const orgIds = [ORG_ID, ORG_NO_ADMIN_ID];
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_USER_ID, REQUESTER_USER_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: orgIds } },
    });
    await stopTestContainers();
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the org has at least one ADMIN role-member", () => {
    it("resolves the admin email, sends the email, and returns ok=true", async () => {
      const result = await caller.user.requestBudgetIncrease({
        organizationId: ORG_ID,
        scope: "user",
        scopeId: REQUESTER_USER_ID,
        limitUsd: "10.00",
        spentUsd: "12.50",
        period: "monthly",
        message: "Need it for the demo on Friday",
      });

      expect(result).toEqual({ ok: true, sentTo: ADMIN_EMAIL });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].to).toBe(ADMIN_EMAIL);
      expect(call[0].subject).toContain(REQUESTER_EMAIL);
      expect(call[0].html).toContain("12.50");
      expect(call[0].html).toContain("10.00");
      expect(call[0].html).toContain("Need it for the demo on Friday");
      expect(call[0].html).toContain("Acme Corp");
    });

    it("works without an optional message — section just isn't rendered", async () => {
      const result = await caller.user.requestBudgetIncrease({
        organizationId: ORG_ID,
        scope: "team",
        scopeId: "team_y",
        limitUsd: "100.00",
        spentUsd: "100.50",
      });

      expect(result.ok).toBe(true);
      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).not.toContain("Message from the user");
    });
  });

  describe("when the org has zero ADMIN role-members", () => {
    it("throws PRECONDITION_FAILED with code 'no_admin_found' and never calls sendEmail", async () => {
      await expect(
        noAdminCaller.user.requestBudgetIncrease({
          organizationId: ORG_NO_ADMIN_ID,
          scope: "user",
          scopeId: REQUESTER_USER_ID,
          limitUsd: "10.00",
          spentUsd: "12.50",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "no_admin_found",
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("when the email layer throws", () => {
    it("re-throws as INTERNAL_SERVER_ERROR with message 'email_send_failed'", async () => {
      vi.mocked(sendEmail).mockImplementationOnce(async () => {
        throw new Error("ses unavailable");
      });

      await expect(
        caller.user.requestBudgetIncrease({
          organizationId: ORG_ID,
          scope: "user",
          scopeId: REQUESTER_USER_ID,
          limitUsd: "10.00",
          spentUsd: "12.50",
        }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "email_send_failed",
      });
    });
  });
});
