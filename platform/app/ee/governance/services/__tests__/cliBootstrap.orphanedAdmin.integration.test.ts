/**
 * @vitest-environment node
 *
 * Integration coverage for the admin-email leg of CliBootstrapService.
 * Hits real PG, no mocks.
 *
 * `OrganizationUser.user` is backed by no database foreign key (the schema
 * runs `relationMode = "prisma"`), so a membership row outlives the account
 * it points at. Joining that required relation made one dangling ADMIN row
 * reject the whole read with "Inconsistent query result: Field user is
 * required to return data, got null instead", which surfaced as a 500 on
 * `/api/auth/cli/bootstrap`. The CLI then cached nothing, so the wrapper
 * had no `tool_policies` left to enforce, hence the toolPolicies
 * assertions below alongside the admin email itself.
 *
 * Spec: specs/ai-gateway/governance/cli-login.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { CliBootstrapService } from "../cliBootstrap.service";
import { PLATFORM_TOOL_SLUGS } from "../platformToolPolicy.service";

const suffix = nanoid(8);
const MIXED_ORG_ID = `org-cbo-${suffix}`;
const ORPHAN_ONLY_ORG_ID = `org-cbo-only-${suffix}`;
const CALLER_USER_ID = `usr-cbo-${suffix}`;
const HEALTHY_ADMIN_ID = `usr-cbo-admin-${suffix}`;
const HEALTHY_ADMIN_EMAIL = `cbo-admin-${suffix}@example.com`;
/** Never inserted into User, so this membership dangles. */
const DELETED_ADMIN_ID = `usr-cbo-deleted-${suffix}`;

/** The orphan is the earliest membership, so ordering hands it over first. */
const ORPHAN_CREATED_AT = new Date("2020-01-01T00:00:00.000Z");
const HEALTHY_CREATED_AT = new Date("2021-01-01T00:00:00.000Z");

describe("CliBootstrapService admin email with orphaned member rows", () => {
  const service = CliBootstrapService.create({
    prisma,
    budgetRepository: undefined,
  });

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.createMany({
      data: [
        { id: MIXED_ORG_ID, name: `CBO Org ${suffix}`, slug: `cbo-${suffix}` },
        {
          id: ORPHAN_ONLY_ORG_ID,
          name: `CBO Orphan Org ${suffix}`,
          slug: `cbo-only-${suffix}`,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: CALLER_USER_ID,
          email: `cbo-${suffix}@example.com`,
          name: "CBO Caller",
        },
        {
          id: HEALTHY_ADMIN_ID,
          email: HEALTHY_ADMIN_EMAIL,
          name: "CBO Admin",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          organizationId: MIXED_ORG_ID,
          userId: DELETED_ADMIN_ID,
          role: "ADMIN",
          createdAt: ORPHAN_CREATED_AT,
        },
        {
          organizationId: MIXED_ORG_ID,
          userId: HEALTHY_ADMIN_ID,
          role: "ADMIN",
          createdAt: HEALTHY_CREATED_AT,
        },
        {
          organizationId: MIXED_ORG_ID,
          userId: CALLER_USER_ID,
          role: "MEMBER",
        },
        {
          organizationId: ORPHAN_ONLY_ORG_ID,
          userId: DELETED_ADMIN_ID,
          role: "ADMIN",
          createdAt: ORPHAN_CREATED_AT,
        },
        {
          organizationId: ORPHAN_ONLY_ORG_ID,
          userId: CALLER_USER_ID,
          role: "MEMBER",
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    const organizationIds = [MIXED_ORG_ID, ORPHAN_ONLY_ORG_ID];
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [CALLER_USER_ID, HEALTHY_ADMIN_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await stopTestContainers();
  }, 60_000);

  describe("when the earliest admin membership outlived its user", () => {
    /** @scenario Login completes when the earliest admin account is gone */
    it("skips the orphan and reports the surviving admin's email", async () => {
      const result = await service.resolve({
        userId: CALLER_USER_ID,
        organizationId: MIXED_ORG_ID,
      });

      expect(result.adminEmail).toBe(HEALTHY_ADMIN_EMAIL);
    });

    /** @scenario Login completes when the earliest admin account is gone */
    it("still returns a complete per-tool policy map for the CLI to cache", async () => {
      const result = await service.resolve({
        userId: CALLER_USER_ID,
        organizationId: MIXED_ORG_ID,
      });

      expect(Object.keys(result.toolPolicies).sort()).toEqual(
        [...PLATFORM_TOOL_SLUGS].sort(),
      );
      expect(result.toolPolicies.cursor).toEqual({
        allowVk: true,
        allowOtelDirect: false,
      });
    });
  });

  describe("when every admin membership in the organization is orphaned", () => {
    /** @scenario Login completes when every admin account is gone */
    it("reports no admin email rather than failing the bootstrap", async () => {
      const result = await service.resolve({
        userId: CALLER_USER_ID,
        organizationId: ORPHAN_ONLY_ORG_ID,
      });

      expect(result.adminEmail).toBeNull();
      expect(Object.keys(result.toolPolicies).sort()).toEqual(
        [...PLATFORM_TOOL_SLUGS].sort(),
      );
    });
  });
});
