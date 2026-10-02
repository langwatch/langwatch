/**
 * @vitest-environment node
 *
 * Whether an address holds a pending invitation, read through the real
 * Prisma client and its tenancy guard: the read spans organizations, so the
 * guard has to admit it as bounded to one address
 * (specs/auth/sign-up-restriction.feature).
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVITE_STATUS, OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaSignUpPolicyRepository } from "../sign-up-policy.prisma.repository";

const ns = `signup-policy-${nanoid(8)}`;
const address = (who: string) => `${who}-${ns}@acme.test`;
const DAY_MS = 24 * 60 * 60 * 1000;

let organizationId: string;

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
    data: { name: "ACME", slug: `--${ns}` },
  });
  organizationId = organization.id;

  await invite(address("pending"));
  await invite(address("no-expiry"), { expiration: null });
  await invite(address("expired"), {
    expiration: new Date(Date.now() - DAY_MS),
  });
  await invite(address("revoked"), { status: INVITE_STATUS.REVOKED });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["organizationInvite", { organizationId }],
    ["organization", { id: organizationId }],
  ]);
});

describe("PrismaSignUpPolicyRepository.hasPendingInvite()", () => {
  const repository = new PrismaSignUpPolicyRepository(prisma);

  describe("when the address holds a pending, unexpired invitation", () => {
    it("answers yes, whatever the case of the address", async () => {
      await expect(
        repository.hasPendingInvite({
          email: address("pending").toUpperCase(),
        }),
      ).resolves.toBe(true);
      await expect(
        repository.hasPendingInvite({ email: address("no-expiry") }),
      ).resolves.toBe(true);
    });
  });

  describe("when the invitation expired or was revoked", () => {
    it("answers no", async () => {
      await expect(
        repository.hasPendingInvite({ email: address("expired") }),
      ).resolves.toBe(false);
      await expect(
        repository.hasPendingInvite({ email: address("revoked") }),
      ).resolves.toBe(false);
    });
  });

  describe("when nobody invited the address", () => {
    it("answers no", async () => {
      await expect(
        repository.hasPendingInvite({ email: address("stranger") }),
      ).resolves.toBe(false);
    });
  });
});
