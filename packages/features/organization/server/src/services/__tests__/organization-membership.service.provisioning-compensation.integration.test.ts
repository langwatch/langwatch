/**
 * @vitest-environment node
 *
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 *
 * The organization and its team commit before provisioning finishes setting
 * them up, and the caller has no id to compensate with until the call returns.
 * A failure after that commit therefore has to be undone here or nowhere: what
 * it would otherwise leave is an organization with no bootstrap key, holding a
 * slug that answers every retry with a 409 until somebody reaches the database
 * directly.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { OrganizationMembershipService } from "../organization-membership.service";
import { PrismaOrganizationMembershipRepository } from "../../repositories/prisma/prisma.organization-membership.repository";
import type {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
} from "../../ports/organization-membership.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const SEEDING_FAILURE = "prompt tag seeding is unavailable";

const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

const seats = {
  checkLimit: vi.fn(),
  assertRoleChangeAllowed: vi.fn(),
} as unknown as OrganizationSeatLicensePort;
const sessions = {
  revokeAllBrowserSessions: vi.fn(),
} as unknown as OrganizationSessionRevocationPort;
const grantCache = {
  invalidateOrganization: vi.fn(),
} as unknown as OrganizationGrantCachePort;

/** A prompt-seed port whose seeding is down, recording who it was asked about. */
function buildFailingPrompts(seenOrganizationIds: string[]): OrganizationPromptSeedPort {
  return {
    seedTagsForOrganization: vi.fn(async ({ organizationId }: { organizationId: string }) => {
      seenOrganizationIds.push(organizationId);
      throw new Error(SEEDING_FAILURE);
    }),
    reportCompensationFailure: vi.fn(),
  } as unknown as OrganizationPromptSeedPort;
}

/** A prompt-seed port that works, for the retry half of the scenario. */
function buildWorkingPrompts(): OrganizationPromptSeedPort {
  return {
    seedTagsForOrganization: vi.fn(async () => {}),
    reportCompensationFailure: vi.fn(),
  } as unknown as OrganizationPromptSeedPort;
}

describe.skipIf(!DB_URL)("OrganizationMembershipService.createForProvisioning", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let repo: PrismaOrganizationMembershipRepository;
  const ns = `prov-comp-${nanoid(8)}`;
  const slug = `--test-org-${ns}`;
  const name = `Provisioning Compensation ${ns}`;

  let retriedOrganizationId: string | undefined;

  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  prisma = connection.client as PrismaClient;
  repo = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: noopGrantsWriter,
  });

  afterAll(async () => {
    if (!prisma) return;
    if (retriedOrganizationId) {
      await prisma.promptTag.deleteMany({ where: { organizationId: retriedOrganizationId } });
      await prisma.team.deleteMany({ where: { organizationId: retriedOrganizationId } });
      await prisma.organization.deleteMany({ where: { id: retriedOrganizationId } });
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
      }).createForProvisioning({ name, slug });
      retriedOrganizationId = retried.organization.id;

      expect(retried.organization.id).not.toBe(orphanedId);
      expect(
        await prisma!.organization.findUnique({ where: { id: retried.organization.id } }),
      ).not.toBeNull();
    });
  });
});
