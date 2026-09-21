/**
 * @vitest-environment node
 *
 * The license registry against a real Postgres: the rules that depend on the
 * table's own constraints rather than on the service's checks.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import { PrismaConnectManagedKeys } from "../connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
} from "../issuedLicense.prisma";
import { LicenseRegistryService } from "../licenseRegistry.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const RUN = `lic-reg-${Date.now()}`;

describe("the license registry on Postgres", () => {
  const organizationIds: string[] = [];
  const service = new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: { sync: async () => undefined },
    seatBilling: { invoiceAddedSeats: async () => "not_onboarded" },
    signingKey: () => privateKey,
    publicKey,
    encrypt: (plain) => `enc:${plain.length}`,
  });

  const issue = async (name: string) => {
    const result = await service.issue({
      customer: { newOrganizationName: `${name} ${RUN}` },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: NEXT_YEAR,
      operatorId: "user_operator",
    });
    organizationIds.push(result.license.organizationId as string);
    return result;
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.issuedLicense.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
  });

  describe("when an operator issues a license for a new customer", () => {
    it("creates the customer organization marked as a self-hosted customer, with a unique slug", async () => {
      const first = await issue("ACME");
      const second = await issue("ACME");

      const organizations = await prisma.organization.findMany({
        where: {
          id: {
            in: [
              first.license.organizationId as string,
              second.license.organizationId as string,
            ],
          },
        },
        select: { slug: true, selfHostedCustomer: true },
      });

      expect(organizations).toHaveLength(2);
      expect(organizations.every((o) => o.selfHostedCustomer)).toBe(true);
      expect(new Set(organizations.map((o) => o.slug)).size).toBe(2);
    });

    it("stores the row with its defaults and finds it by the token hash", async () => {
      const { license } = await issue("ACME Defaults");
      const stored = await prisma.issuedLicense.findUnique({
        where: { id: license.id },
      });

      expect(stored).toMatchObject({
        services: [],
        commitUsdCents: 0,
        overageEnabled: false,
        instanceId: null,
        revokedAt: null,
      });
      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        (
          await new PrismaIssuedLicenseRepository(prisma).findByTokenHash(
            stored?.tokenHash as string,
          )
        )?.id,
      ).toBe(license.id);
    });
  });

  describe("when the same license is reissued twice", () => {
    it("refuses the second with license_already_reissued, from the table's own unique constraint", async () => {
      const { license } = await issue("ACME Reissue");
      await service.reissue({
        id: license.id,
        maxMembers: 80,
        expiresAt: NEXT_YEAR,
        operatorId: "user_operator",
      });

      await expect(
        service.reissue({
          id: license.id,
          maxMembers: 90,
          expiresAt: NEXT_YEAR,
          operatorId: "user_operator",
        }),
      ).rejects.toMatchObject({ code: "license_already_reissued" });

      expect(
        await prisma.issuedLicense.count({ where: { replacesId: license.id } }),
      ).toBe(1);
    });
  });

  describe("when a managed key is recorded against a license that was revoked meanwhile", () => {
    /** @scenario The managed key is recorded only while the license still admits the call */
    it("refuses the write and leaves the license without a key", async () => {
      const { license } = await issue("ACME Attach Race");
      const repository = new PrismaIssuedLicenseRepository(prisma);
      const requires = {
        organizationId: license.organizationId as string,
        instanceId: "instance-a",
        activeAt: new Date(),
      };
      await prisma.issuedLicense.update({
        where: { id: license.id },
        data: { instanceId: "instance-a" },
      });
      // What the resolve path read as active, revoked before its write lands.
      await prisma.issuedLicense.update({
        where: { id: license.id },
        data: { revokedAt: new Date(), revokedReason: "leaked" },
      });

      const attached = await repository.attachVirtualKey({
        id: license.id,
        virtualKeyId: "vk_should_not_attach",
        requires,
      });

      expect(attached).toBe(false);
      expect(
        (await prisma.issuedLicense.findUnique({ where: { id: license.id } }))
          ?.virtualKeyId,
      ).toBeNull();
    });
  });

  describe("when two installs present the same license at the same moment", () => {
    /** @scenario Two instances racing to bind leave exactly one bound */
    it("binds the first and refuses the second, which is still waiting on its row", async () => {
      const { license } = await issue("ACME Bind Race");
      const at = new Date();
      const bindFor = (instance: string) => (tx: Prisma.TransactionClient) =>
        new PrismaIssuedLicenseRepository(tx).bindInstance({
          id: license.id,
          instanceId: instance,
          at,
        });

      const binds = await raceOnOneRow({
        prisma,
        table: "IssuedLicense",
        first: bindFor("instance-first"),
        second: bindFor("instance-second"),
      });

      expect(binds.first).toBe(true);
      expect(binds.second).toBe(false);
      expect(
        (await prisma.issuedLicense.findUnique({ where: { id: license.id } }))
          ?.instanceId,
      ).toBe("instance-first");
    });
  });

  describe("when a managed key is attached while a revocation is landing", () => {
    /** @scenario The managed key is recorded only while the license still admits the call */
    it("refuses the attach, because the write re-reads the row it waited for", async () => {
      const { license } = await issue("ACME Attach Interleaving");
      const organizationId = license.organizationId as string;
      await prisma.issuedLicense.update({
        where: { id: license.id },
        data: { instanceId: "instance-a" },
      });

      // The revocation commits first, holding the row. The attach was resolved
      // against a license that was still active, and has to lose.
      const answers = await raceOnOneRow<boolean>({
        prisma,
        table: "IssuedLicense",
        first: async (tx) => {
          await tx.issuedLicense.update({
            where: { id: license.id },
            data: { revokedAt: new Date(), revokedReason: "leaked" },
          });
          return true;
        },
        second: (tx) =>
          new PrismaIssuedLicenseRepository(tx).attachVirtualKey({
            id: license.id,
            virtualKeyId: `vk_${RUN}_should_not_attach`,
            requires: {
              organizationId,
              instanceId: "instance-a",
              activeAt: new Date(),
            },
          }),
      });

      expect(answers.second).toBe(false);
      expect(
        (await prisma.issuedLicense.findUnique({ where: { id: license.id } }))
          ?.virtualKeyId,
      ).toBeNull();
    });
  });

  describe("when the list is searched", () => {
    it("matches on the customer name without regard to case", async () => {
      await issue("Zebra Logistics");

      const { licenses, total } = await service.getAll({
        page: 0,
        pageSize: 25,
        search: `zebra logistics ${RUN}`.toUpperCase(),
      });

      expect(total).toBe(1);
      expect(licenses[0]?.organizationName).toContain("Zebra Logistics");
    });
  });
});
