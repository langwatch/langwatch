/** The membership row an SSO-admitted arrival gets, on the organization's joiner seat (ADR-171). */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { OrganizationUserRole, Prisma } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const organizationFindUnique = vi.fn();
const memberCreate = vi.fn();
const memberFindUnique = vi.fn();
const auditLogCreate = vi.fn();
type OutboxRow = Prisma.ProcessManagerOutboxCreateManyInput;
const outboxCreateMany = vi.fn(async (_input?: { data: OutboxRow[] | OutboxRow }) => ({
  count: 1,
}));

const transactionClient = prismaDouble({
  organizationUser: { create: memberCreate, findUnique: memberFindUnique },
  auditLog: { create: auditLogCreate },
  processManagerOutbox: { createMany: outboxCreateMany },
});

const prisma = prismaDouble({
  organization: { findUnique: organizationFindUnique },
  organizationUser: { create: memberCreate, findUnique: memberFindUnique },
  auditLog: { create: auditLogCreate },
  $transaction: (run) => run(transactionClient),
});

/** The audit intents the admission's own transaction appended to organization's outbox. */
function auditIntents() {
  return outboxCreateMany.mock.calls.flatMap(([input]) => [input?.data ?? []].flat());
}

let repository: PrismaOrganizationMembershipRepository;

function arrange({
  joinerRole,
  existingRole = null,
}: {
  joinerRole: OrganizationUserRole;
  existingRole?: OrganizationUserRole | null;
}) {
  organizationFindUnique.mockResolvedValue({ joinerRole });
  memberCreate.mockImplementation(async () => {
    if (existingRole) {
      throw new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      });
    }
    return {};
  });
  memberFindUnique.mockResolvedValue(existingRole ? { role: existingRole } : null);
}

function admit() {
  return repository.createMembership({
    userId: "user_sam",
    organizationId: "org_acme",
    pendingAdmissionId: "rolebinding_pending",
    via: "sso",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auditLogCreate.mockResolvedValue({});
  outboxCreateMany.mockResolvedValue({ count: 1 });
  repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    grants: createApiFixture<AuthzGrantsService>({}),
  });
});

describe("given an organization whose joiner seat is Developer", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes a Developer row with no organization-wide grant pending", async () => {
      arrange({ joinerRole: OrganizationUserRole.DEVELOPER });

      await expect(admit()).resolves.toEqual({ outcome: "created", seat: "DEVELOPER" });

      expect(memberCreate).toHaveBeenCalledWith({
        data: {
          userId: "user_sam",
          organizationId: "org_acme",
          role: OrganizationUserRole.DEVELOPER,
          pendingSsoGrantId: null,
        },
      });
    });

    it("audits the admission itself, since no grant will", async () => {
      arrange({ joinerRole: OrganizationUserRole.DEVELOPER });

      await admit();

      expect(auditLogCreate).not.toHaveBeenCalled();
      expect(auditIntents()).toEqual([
        expect.objectContaining({
          processName: "organizationAudit",
          intentType: "recordAudit",
          payload: expect.objectContaining({
            tenantId: "org_acme",
            action: "organization.member.admitted",
            userId: "user_sam",
            organizationId: "org_acme",
            metadata: { seat: "DEVELOPER", via: "sso" },
          }),
        }),
      ]);
    });
  });
});

describe("given a Developer-joiner organization where a Full member's row already exists", () => {
  describe("when a concurrent sign-in tries to create the row again", () => {
    it("answers the seat the existing row holds, not the setting", async () => {
      arrange({
        joinerRole: OrganizationUserRole.DEVELOPER,
        existingRole: OrganizationUserRole.MEMBER,
      });

      await expect(admit()).resolves.toEqual({ outcome: "already-present", seat: "MEMBER" });
      expect(auditIntents()).toEqual([]);
    });
  });
});

describe("given an organization that never changed the setting", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting is Full by default */
    it("writes a Full member row with the organization-wide grant pending", async () => {
      arrange({ joinerRole: OrganizationUserRole.MEMBER });

      await expect(admit()).resolves.toEqual({ outcome: "created", seat: "MEMBER" });

      expect(memberCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: OrganizationUserRole.MEMBER,
          pendingSsoGrantId: "rolebinding_pending",
        }),
      });
      expect(auditIntents()).toEqual([]);
    });
  });
});

describe("given a Full-seat organization and a join request made from the terminal (ADR-171 v6)", () => {
  describe("when identity hands the decided Developer seat and the origin", () => {
    /** @scenario A request made from the terminal lands as a Developer when approved */
    it("writes the decided seat, never reads the setting, and audits where it came from", async () => {
      arrange({ joinerRole: OrganizationUserRole.MEMBER });

      await expect(
        repository.createMembership({
          userId: "user_sam",
          organizationId: "org_acme",
          pendingAdmissionId: "rolebinding_pending",
          via: "join-request-approved",
          seat: "DEVELOPER",
          origin: "cli",
        }),
      ).resolves.toEqual({ outcome: "created", seat: "DEVELOPER" });

      expect(organizationFindUnique).not.toHaveBeenCalled();
      expect(auditIntents()).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            action: "organization.member.admitted",
            userId: "user_sam",
            organizationId: "org_acme",
            metadata: { seat: "DEVELOPER", via: "join-request-approved", origin: "cli" },
          }),
        }),
      ]);
    });
  });
});
