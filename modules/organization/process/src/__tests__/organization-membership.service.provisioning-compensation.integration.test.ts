import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
/**
 * Provisioning failures after org commit need rollback: without it, the slug
 * is locked with no bootstrap key until someone reaches the database directly.
 * @vitest-environment node
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";

import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
} from "../app/organization.members.ts";
import { PrismaOrganizationMembershipRepository } from "../repositories/prisma/prisma.organization-membership.repository.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const SEEDING_FAILURE = "prompt tag seeding is unavailable";

const noopGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
});

const seats: OrganizationSeatLicense = {
  checkLimit: vi.fn(),
  assertRoleChangeAllowed: vi.fn(),
};
const sessions: OrganizationSessionRevocation = {
  revokeAllBrowserSessions: vi.fn(),
};
const grantCache: OrganizationGrantCache = {
  invalidateOrganization: vi.fn(),
};

/** A prompt-seed port whose seeding is down, recording who it was asked about. */
function buildFailingPrompts(seenOrganizationIds: string[]): OrganizationPromptSeed {
  return {
    seedTagsForOrganization: vi.fn(async ({ organizationId }: { organizationId: string }) => {
      seenOrganizationIds.push(organizationId);
      throw new Error(SEEDING_FAILURE);
    }),
    reportCompensationFailure: vi.fn(),
  };
}

/** A prompt-seed port that works, for the retry half of the scenario. */
function buildWorkingPrompts(): OrganizationPromptSeed {
  return {
    seedTagsForOrganization: vi.fn(async () => {}),
    reportCompensationFailure: vi.fn(),
  };
}

describe.skipIf(!DB_URL)("OrganizationMembershipService.createForProvisioning", () => {
  const ns = `prov-comp-${nanoid(8)}`;
  const slug = `--test-org-${ns}`;
  const name = `Provisioning Compensation ${ns}`;

  let retriedOrganizationId: string | undefined;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger(
      "langwatch:organization:test:organization-membership-service-provisioning-compensation",
    ),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repo = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: noopGrantsWriter,
  });

  afterAll(async () => {
    if (!prisma) return;
    if (retriedOrganizationId) {
      await cleanupTestRows(prisma, [
        ["promptTag", { organizationId: retriedOrganizationId }],
        ["team", { organizationId: retriedOrganizationId }],
        ["organization", { id: retriedOrganizationId }],
      ]);
    }
    await prisma.$disconnect();
  });

  describe("given the setup that follows the organization write fails", () => {
    /** @scenario Provisioning that fails while setting the organization up leaves nothing behind */
    it("leaves no organization or team behind, and the slug provisions afterwards", async () => {
      const attempted: string[] = [];
      const failing = OrganizationMembershipService.create({
        repository: repo,
        prompts: buildFailingPrompts(attempted),
        seats,
        sessions,
        grantCache,
        testArrivals: { standingFor: async () => ({ testing: false }) as const },
        admissions: {
          attachBindings: () => Promise.reject(new Error("no admission expected")),
          completeAdmission: () => Promise.reject(new Error("no admission expected")),
        },
      });

      await expect(failing.createForProvisioning({ name, slug })).rejects.toThrow(SEEDING_FAILURE);

      // The failure has to have happened after the organization committed,
      // or the test would pass without exercising the compensation at all.
      expect(attempted).toHaveLength(1);
      const orphanedId = attempted[0]!;

      expect(await prisma!.organization.findUnique({ where: { id: orphanedId } })).toBeNull();
      expect(await prisma!.team.count({ where: { organizationId: orphanedId } })).toBe(0);
      expect(await prisma!.organization.findFirst({ where: { slug } })).toBeNull();

      const retried = await OrganizationMembershipService.create({
        repository: repo,
        prompts: buildWorkingPrompts(),
        seats,
        sessions,
        grantCache,
        testArrivals: { standingFor: async () => ({ testing: false }) as const },
        admissions: {
          attachBindings: () => Promise.reject(new Error("no admission expected")),
          completeAdmission: () => Promise.reject(new Error("no admission expected")),
        },
      }).createForProvisioning({ name, slug });
      retriedOrganizationId = retried.organization.id;

      expect(retried.organization.id).not.toBe(orphanedId);
      expect(
        await prisma!.organization.findUnique({ where: { id: retried.organization.id } }),
      ).not.toBeNull();
    });
  });
});
