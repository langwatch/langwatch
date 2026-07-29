import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { ApiKeyService } from "../api-key.service";

/**
 * Authentication-time rejection of keys that should no longer work.
 *
 * These run against a real database on purpose: the deactivated-owner guard
 * lives in the lookup's `where` clause, so a mocked repository would only
 * hand back whatever the test told it to.
 *
 * @see specs/api-keys/unified-api-keys.feature
 */
describe("Feature: API key verification", () => {
  const ns = `apikey-verify-${nanoid(8)}`;
  const service = ApiKeyService.create(prisma);

  let organizationId: string;
  let userId: string;

  /** The minting ceiling reads role bindings, not OrganizationUser rows. */
  const grantOrgAdmin = async (id: string) => {
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
  };

  const mintKey = async () => {
    const created = await service.create({
      name: `verify-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
    });
    return created;
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Verify Test Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const user = await prisma.user.create({
      data: { name: "Verify Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await grantOrgAdmin(userId);
  });

  afterAll(async () => {
    await prisma.roleBinding
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.apiKey
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.organization
      .delete({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  describe("given a freshly minted key", () => {
    it("verifies the token", async () => {
      const { token, apiKey } = await mintKey();

      const verified = await service.verify({ token });

      expect(verified?.id).toBe(apiKey.id);
    });

    describe("when the token has been tampered with", () => {
      it("rejects it", async () => {
        const { token } = await mintKey();

        const verified = await service.verify({ token: `${token}x` });

        expect(verified).toBeNull();
      });
    });
  });

  describe("given the key has been revoked", () => {
    it("rejects it at authentication", async () => {
      const { token, apiKey } = await mintKey();
      await expect(service.verify({ token })).resolves.not.toBeNull();

      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { revokedAt: new Date() },
      });

      await expect(service.verify({ token })).resolves.toBeNull();
    });
  });

  describe("given the key has expired", () => {
    it("rejects it at authentication", async () => {
      const { token, apiKey } = await mintKey();

      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      await expect(service.verify({ token })).resolves.toBeNull();
    });

    describe("when the expiry is still in the future", () => {
      it("verifies the token", async () => {
        const { token, apiKey } = await mintKey();

        await prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { expiresAt: new Date(Date.now() + 3_600_000) },
        });

        await expect(service.verify({ token })).resolves.not.toBeNull();
      });
    });
  });

  describe("given the owning user has been deactivated", () => {
    /**
     * Offboarding a person must take their keys with them, without anyone
     * having to revoke each one by hand.
     */
    it("rejects the key at authentication", async () => {
      const deactivated = await prisma.user.create({
        data: {
          name: "Deactivated User",
          email: `deactivated-${ns}@example.com`,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: deactivated.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await grantOrgAdmin(deactivated.id);

      const { token } = await service.create({
        name: `deactivated-${nanoid(6)}`,
        userId: deactivated.id,
        createdByUserId: deactivated.id,
        organizationId,
        permissionMode: "all",
        bindings: [
          {
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      await expect(service.verify({ token })).resolves.not.toBeNull();

      await prisma.user.update({
        where: { id: deactivated.id },
        data: { deactivatedAt: new Date() },
      });

      await expect(service.verify({ token })).resolves.toBeNull();

      await prisma.roleBinding
        .deleteMany({ where: { userId: deactivated.id } })
        .catch(() => {});
      await prisma.apiKey
        .deleteMany({ where: { userId: deactivated.id } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { userId: deactivated.id } })
        .catch(() => {});
      await prisma.user
        .delete({ where: { id: deactivated.id } })
        .catch(() => {});
    });
  });
});
