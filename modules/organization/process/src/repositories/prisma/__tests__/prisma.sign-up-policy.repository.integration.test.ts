/**
 * @vitest-environment node
 * A pending-invitation read through the real Prisma client and tenancy guard,
 * which has to admit a read bounded to one address across organizations.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { INVITE_STATUS, OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaSignUpPolicyRepository } from "../prisma.sign-up-policy.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!DB_URL)("PrismaSignUpPolicyRepository", () => {
  const namespace = `signup-policy-${nanoid(8)}`;
  const address = (who: string) => `${who}-${namespace}@acme.test`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:sign-up-policy-repository"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaSignUpPolicyRepository.create(prisma);

  let organizationId = "";

  const invite = (
    email: string,
    {
      status = INVITE_STATUS.PENDING,
      expiration = new Date(Date.now() + DAY_MS),
    }: { status?: INVITE_STATUS; expiration?: Date | null } = {},
  ) =>
    prisma.organizationInvite.create({
      data: {
        email,
        inviteCode: `code-${nanoid(12)}`,
        organizationId,
        teamIds: "",
        role: OrganizationUserRole.MEMBER,
        status,
        expiration,
      },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--test-${namespace}` },
    });
    organizationId = organization.id;

    await invite(address("pending"));
    await invite(address("no-expiry"), { expiration: null });
    await invite(address("expired"), { expiration: new Date(Date.now() - DAY_MS) });
    await invite(address("revoked"), { status: INVITE_STATUS.REVOKED });
  });

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("when the address holds a pending, unexpired invitation", () => {
    it("returns its code, whatever the case of the address", async () => {
      const [code] = await repository.findPendingInviteCodes({
        email: address("pending").toUpperCase(),
      });

      expect(code).toMatch(/^code-/);
      await expect(
        repository.findPendingInviteCodes({ email: address("no-expiry") }),
      ).resolves.toHaveLength(1);
    });
  });

  describe("when the invitation expired or was revoked", () => {
    it("returns none", async () => {
      await expect(
        repository.findPendingInviteCodes({ email: address("expired") }),
      ).resolves.toEqual([]);
      await expect(
        repository.findPendingInviteCodes({ email: address("revoked") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the address was never invited", () => {
    it("returns none", async () => {
      await expect(
        repository.findPendingInviteCodes({ email: address("stranger") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the installation holds an organization", () => {
    it("says so", async () => {
      await expect(repository.hasAnyOrganization()).resolves.toBe(true);
    });
  });
});
