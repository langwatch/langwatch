/**
 * A founder's membership is held disabled until both founder grants are confirmed,
 * and a failed attach leaves no organization behind.
 * @vitest-environment node
 * @see specs/features/onboarding/intent-fork.feature
 */
import type { AuthzAttachBindingsInput, AuthzGrantsService } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.createAndAssign founder hold",
  () => {
    const namespace = `founder-${nanoid(8)}`;
    const userId = `user-${namespace}`;
    const organizationIds: string[] = [];

    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:founder-grants"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;

    function repositoryWith(attachBindings: AuthzGrantsService["attachBindings"]) {
      return PrismaOrganizationMembershipRepository.create({
        database: prisma,
        cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
        grants: createApiFixture<AuthzGrantsService>({
          attachBindings,
          revokeBindingsWhere: async () => 0,
        }),
      });
    }

    function creationInput() {
      const id = `${namespace}-${nanoid(6).toLowerCase()}`;
      organizationIds.push(`org-${id}`);
      return {
        userId,
        orgId: `org-${id}`,
        orgName: "ACME",
        orgSlug: `org-${id}`,
        teamId: `team-${id}`,
        teamSlug: `team-${id}`,
        pricingModel: "SEAT_EVENT" as const,
      };
    }

    const founderMembership = (organizationId: string) =>
      prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { disabledAt: true, membershipStamp: true },
      });

    beforeAll(async () => {
      await prisma.user.create({ data: { id: userId, email: `${namespace}@example.com` } });
    });

    afterAll(async () => {
      const organizationId = { in: organizationIds };
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    describe("when the founder grants are still being projected", () => {
      /** @scenario "Founder organization is committed before grants and stays inaccessible until confirmation" */
      it("keeps the committed membership disabled until both grants are confirmed", async () => {
        let openGate = () => {};
        const gate = new Promise<void>((resolve) => {
          openGate = resolve;
        });
        let reachWriter = (_input: AuthzAttachBindingsInput) => {};
        const reached = new Promise<AuthzAttachBindingsInput>((resolve) => {
          reachWriter = resolve;
        });
        const repository = repositoryWith(async (input) => {
          reachWriter(input);
          await gate;
          return { attached: input.bindings.map((binding) => binding.bindingId), duplicates: [] };
        });
        const input = creationInput();
        const pending = repository.createAndAssign(input);

        try {
          const attach = await reached;
          expect(await prisma.organization.count({ where: { id: input.orgId } })).toBe(1);
          const held = await founderMembership(input.orgId);
          expect(held?.disabledAt).toEqual(expect.any(Date));
          expect(attach.requireProjection).toBe(true);
          expect(attach.bindings).toEqual([
            expect.objectContaining({
              scopeType: "ORGANIZATION",
              scopeId: input.orgId,
              role: "ADMIN",
              membershipStamp: held?.membershipStamp,
              membershipBootstrap: true,
            }),
            expect.objectContaining({
              scopeType: "TEAM",
              scopeId: input.teamId,
              role: "ADMIN",
              membershipStamp: held?.membershipStamp,
              membershipBootstrap: true,
            }),
          ]);
        } finally {
          openGate();
        }

        const result = await pending;
        expect(result.organization.id).toBe(input.orgId);
        expect((await founderMembership(input.orgId))?.disabledAt).toBeNull();
      });
    });

    describe("when no founder grant can be confirmed", () => {
      it("deletes the organization, its team and the held membership, and rethrows", async () => {
        const repository = repositoryWith(async () => {
          throw new Error("append unavailable");
        });
        const input = creationInput();

        await expect(repository.createAndAssign(input)).rejects.toThrow("append unavailable");

        expect(await prisma.organization.count({ where: { id: input.orgId } })).toBe(0);
        expect(await prisma.team.count({ where: { id: input.teamId } })).toBe(0);
        expect(await founderMembership(input.orgId)).toBeNull();
      });
    });
  },
);
