/**
 * The licence write and clear on the organization row, and the administrator a support
 * contact falls back to, against Postgres.
 * @vitest-environment node
 * @see modules/organization/specs/organization-service.feature
 */
import { createLogger } from "@langwatch/observability";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository licence and first administrator", () => {
  const namespace = `org-license-${nanoid(8)}`;
  const licensedId = `${namespace}-licensed`;
  const staffedId = `${namespace}-staffed`;
  const unstaffedId = `${namespace}-unstaffed`;
  const userIds: string[] = [];

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:license"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  const seat = async (input: {
    organizationId: string;
    name: string;
    seatedAt: string;
    disabled?: boolean;
  }) => {
    const user = await prisma.user.create({
      data: { email: `${input.name}-${namespace}@test.com`, name: input.name },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: input.organizationId,
        role: OrganizationUserRole.ADMIN,
        createdAt: new Date(input.seatedAt),
        disabledAt: input.disabled ? new Date(input.seatedAt) : null,
      },
    });
  };

  beforeAll(async () => {
    for (const id of [licensedId, staffedId, unstaffedId]) {
      await prisma.organization.create({ data: { id, name: id, slug: id } });
    }
    await seat({ organizationId: staffedId, name: "gone", seatedAt: "2026-01-01", disabled: true });
    await seat({ organizationId: staffedId, name: "early", seatedAt: "2026-02-01" });
    await seat({ organizationId: staffedId, name: "late", seatedAt: "2026-03-01" });
    await seat({
      organizationId: unstaffedId,
      name: "off",
      seatedAt: "2026-01-01",
      disabled: true,
    });
  });

  afterAll(async () => {
    const organizationIds = [licensedId, staffedId, unstaffedId];
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const stored = () =>
    prisma.organization.findUniqueOrThrow({
      where: { id: licensedId },
      select: { license: true, licenseExpiresAt: true, licenseLastValidatedAt: true },
    });

  describe("given an organization in Postgres", () => {
    describe("when a licence is set with its expiry and the moment it was validated", () => {
      /** @scenario "A licence is stored with the moment it was validated and cleared with both its dates" */
      it("stores all three, clears all three, and refuses an unknown organization", async () => {
        const expiresAt = Temporal.Instant.from("2027-09-01T00:00:00Z");
        const validatedAt = Temporal.Instant.from("2026-10-08T12:00:00Z");

        await repository.setLicense({
          organizationId: licensedId,
          licenseKey: "key-1",
          expiresAt,
          validatedAt,
        });
        expect(await stored()).toEqual({
          license: "key-1",
          licenseExpiresAt: new Date("2027-09-01T00:00:00Z"),
          licenseLastValidatedAt: new Date("2026-10-08T12:00:00Z"),
        });

        await repository.setLicense({
          organizationId: licensedId,
          licenseKey: "key-2",
          expiresAt,
          validatedAt: null,
        });
        expect((await stored()).licenseLastValidatedAt).toBeNull();

        await repository.clearLicense({ organizationId: licensedId });
        expect(await stored()).toEqual({
          license: null,
          licenseExpiresAt: null,
          licenseLastValidatedAt: null,
        });

        await expect(
          repository.setLicense({
            organizationId: `${namespace}-none`,
            licenseKey: "key-1",
            expiresAt,
            validatedAt: null,
          }),
        ).rejects.toMatchObject({ code: "organization_not_found" });
        await expect(
          repository.clearLicense({ organizationId: `${namespace}-none` }),
        ).rejects.toMatchObject({ code: "organization_not_found" });
      });
    });
  });

  describe("given an organization whose earliest administrator is disabled, followed by two enabled administrators", () => {
    describe("when its first administrator's email is read", () => {
      /** @scenario "The longest-seated enabled administrator is read from Postgres" */
      it("answers the earlier-seated enabled administrator, and none where nobody is enabled", async () => {
        expect(await repository.findFirstAdministratorEmail(staffedId)).toBe(
          `early-${namespace}@test.com`,
        );
        expect(await repository.findFirstAdministratorEmail(unstaffedId)).toBeNull();
      });
    });
  });
});
