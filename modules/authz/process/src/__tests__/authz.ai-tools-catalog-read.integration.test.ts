/**
 * @vitest-environment node
 * @see specs/ai-governance/personal-portal/tool-catalog-rbac.feature
 * `aiTools:view` sits in the org-member bag every membership holds.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import {
  PrismaAuthzBindingRepository,
  type AuthzBindingDatabase,
} from "../repositories/prisma/prisma.authz-binding.repository.ts";
import { PrismaAuthzListingRepository } from "../repositories/prisma/prisma.authz-listing.repository.ts";
import { PrismaAuthzReadRepository } from "../repositories/prisma/prisma.authz-read.repository.ts";
import type { AuthzDatabase } from "../repositories/authz-read.repository.ts";
import { AuthzService } from "../services/authz.service.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

const uniqueSuffix = () => randomUUID().replaceAll("-", "").slice(0, 12);

describe.skipIf(!DB_URL)("given an organization publishing an AI tools catalog", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma as unknown as AuthzDatabase;
  const authz = AuthzService.create({
    repository: PrismaAuthzReadRepository.create(database),
    listing: PrismaAuthzListingRepository.create(database),
    bindings: PrismaAuthzBindingRepository.create({ database: prisma as unknown as AuthzBindingDatabase }),
    isOnEngine: async () => false,
  });

  const testNamespace = `aitools-rbac-${uniqueSuffix()}`;
  let organizationId: string;
  let liteUserId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    const lite = await prisma.user.create({
      data: { name: "Mallory", email: `lite-${testNamespace}@example.com` },
    });
    liteUserId = lite.id;

    await prisma.organizationUser.create({
      data: { userId: liteUserId, organizationId, role: "EXTERNAL" },
    });
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { id: liteUserId }],
    ]);
    await prisma.$disconnect();
  });

  describe("when a lite member is checked for the catalog read grant", () => {
    /** @scenario External (lite) members can also list (portal must work for everyone) */
    it("allows aiTools:view on the organization, with no binding of their own", async () => {
      const bindings = await prisma.roleBinding.count({
        where: { organizationId, userId: liteUserId },
      });
      expect(bindings).toBe(0);

      await expect(
        authz.hasPermission({
          userId: liteUserId,
          permission: "aiTools:view",
          organizationId,
        }),
      ).resolves.toBe(true);
    });

    /** @scenario External (lite) members can also list (portal must work for everyone) */
    it("still refuses them the curation grant the same read does not carry", async () => {
      await expect(
        authz.hasPermission({
          userId: liteUserId,
          permission: "aiTools:manage",
          organizationId,
        }),
      ).resolves.toBe(false);
    });
  });
});
