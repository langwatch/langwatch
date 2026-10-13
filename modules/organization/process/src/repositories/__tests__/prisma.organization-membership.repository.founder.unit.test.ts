/**
 * A founder organization stays when its grants are only slow, and goes when they are refused.
 * @see modules/organization/specs/organization-service.feature
 */
import {
  AuthzGrantNotConfirmedError,
  BindingMissingError,
  type AuthzGrantsService,
} from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const FOUNDER = {
  userId: "user_founder",
  orgId: "org_new",
  orgName: "Acme",
  orgSlug: "acme",
  teamId: "team_new",
  teamSlug: "acme",
  pricingModel: "SEAT_EVENT",
} as const;

function founderRepository({ attach }: { attach: () => Promise<never> }) {
  const enabled: unknown[] = [];
  const tx = prismaDouble({
    organization: { create: vi.fn(async () => ({ id: FOUNDER.orgId, name: FOUNDER.orgName })) },
    organizationUser: { create: vi.fn(async () => ({ membershipStamp: "stamp_1" })) },
    team: {
      create: vi.fn(async () => ({ id: FOUNDER.teamId, slug: FOUNDER.teamSlug, name: "Acme" })),
    },
  });
  const prisma = prismaDouble({
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    organizationUser: {
      update: vi.fn(async (args: { data: unknown }) => void enabled.push(args.data)),
    },
  });
  const repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    grants: createApiFixture<AuthzGrantsService>({ attachBindings: attach }),
  });
  const deleted = vi
    .spyOn(repository, "deleteProvisionedOrganization")
    .mockResolvedValue(undefined);
  return { repository, enabled, deleted };
}

describe("PrismaOrganizationMembershipRepository.createAndAssign", () => {
  describe("given founder grants appended but not confirmed in time", () => {
    /** @scenario "A founder organization whose grants are slow to land is kept" */
    it("keeps the organization and enables the membership", async () => {
      const { repository, enabled, deleted } = founderRepository({
        attach: async () => {
          throw new AuthzGrantNotConfirmedError();
        },
      });

      const created = await repository.createAndAssign(FOUNDER);

      expect(created).toMatchObject({
        organization: { id: FOUNDER.orgId },
        grantsConfirmed: false,
      });
      expect(enabled).toEqual([{ disabledAt: null }]);
      expect(deleted).not.toHaveBeenCalled();
    });
  });

  describe("given founder grants that are refused", () => {
    /** @scenario "A founder organization whose grants are refused is removed" */
    it("removes the organization and raises the refusal", async () => {
      const { repository, enabled, deleted } = founderRepository({
        attach: async () => {
          throw new BindingMissingError();
        },
      });

      await expect(repository.createAndAssign(FOUNDER)).rejects.toBeInstanceOf(BindingMissingError);
      expect(deleted).toHaveBeenCalledWith(FOUNDER.orgId);
      expect(enabled).toEqual([]);
    });
  });
});
