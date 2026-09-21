/**
 * The membership write that straddles a grants-ledger append, seen from the
 * crash window between the seat update and the canonical role correction.
 */

import { grantFactToRow } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
} from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

const memberFindUnique = vi.fn();
const memberUpdate = vi.fn();
const memberUpdateMany = vi.fn();
const teamFindMany = vi.fn();
const teamUpdateMany = vi.fn();
const projectUpdateMany = vi.fn();
const grantFindMany = vi.fn();

const transactionClient = {
  organizationUser: {
    findUnique: memberFindUnique,
    count: vi.fn().mockResolvedValue(2),
    update: memberUpdate,
    updateMany: memberUpdateMany,
  },
  team: { findMany: teamFindMany, updateMany: teamUpdateMany },
  project: { updateMany: projectUpdateMany },
  grant: { findMany: grantFindMany },
} as unknown as Prisma.TransactionClient;

const prisma = {
  ...transactionClient,
  $transaction: (
    run: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<unknown> => run(transactionClient),
} as unknown as PrismaClient;

const attachBindings = vi.fn();
const changeBindingRole = vi.fn();
const revokeBindings = vi.fn();
const revokeBindingsWhere = vi.fn();

const writer = {
  attachBindings,
  changeBindingRole,
  revokeBindings,
  revokeBindingsWhere,
} as unknown as GrantsLedgerWriter;

let repository: PrismaOrganizationRepository;

beforeEach(() => {
  vi.clearAllMocks();
  memberUpdate.mockResolvedValue(undefined);
  memberUpdateMany.mockResolvedValue({ count: 1 });
  teamFindMany.mockResolvedValue([]);
  teamUpdateMany.mockResolvedValue({ count: 0 });
  projectUpdateMany.mockResolvedValue({ count: 0 });
  grantFindMany.mockResolvedValue([]);
  attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
  changeBindingRole.mockResolvedValue(undefined);
  revokeBindings.mockResolvedValue(undefined);
  revokeBindingsWhere.mockResolvedValue(0);
  repository = new PrismaOrganizationRepository(prisma, writer);
});

describe("given an admin being demoted to member", () => {
  describe("when the binding correction fails after the seat has committed", () => {
    it("puts the seat back, so no ADMIN binding is left under a MEMBER seat", async () => {
      memberFindUnique.mockResolvedValue({
        userId: "user_a",
        organizationId: "org_1",
        role: OrganizationUserRole.ADMIN,
      });
      grantFindMany.mockResolvedValue([
        {
          ...grantFactToRow({
            organizationId: "org_1",
            grant: {
              grantId: "binding_1",
              principal: { type: "user", id: "user_a" },
              roleKey: "admin",
              legacyRole: "ADMIN",
              scope: { type: "ORGANIZATION", id: "org_1" },
              source: "grants-service",
              occurredAtMs: 1,
            },
          }),
          updatedAt: new Date(1),
        },
      ]);
      changeBindingRole.mockRejectedValue(new Error("ledger unavailable"));

      await expect(
        repository.updateMemberRole({
          organizationId: "org_1",
          userId: "user_a",
          role: OrganizationUserRole.MEMBER,
          effectiveTeamRoleUpdates: [],
          currentUserId: "user_b",
        }),
      ).rejects.toThrow("ledger unavailable");

      expect(memberUpdateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          userId: "user_a",
          role: OrganizationUserRole.MEMBER,
        },
        data: { role: OrganizationUserRole.ADMIN },
      });
    });
  });
});
