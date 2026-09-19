/**
 * @vitest-environment node
 *
 * The connect host's license sync against real Postgres: a registered license
 * posts its seats, the row and the quarter's peak are written, and the answer
 * carries a lease the install can verify with the public key it embeds.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */

import { generateKeyPairSync } from "node:crypto";
import { verifyLease } from "@ee/licensing/connect/lease";
import { licenseTokenFromKey } from "@ee/licensing/licenseToken";
import { PrismaConnectManagedKeys } from "@ee/licensing/registry/connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
  PrismaLicenseSeatReports,
} from "@ee/licensing/registry/issuedLicense.prisma";
import { LicenseRegistryService } from "@ee/licensing/registry/licenseRegistry.service";
import { validateLicense } from "@ee/licensing/validation";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { encrypt } from "~/utils/encryption";
import { app } from "../connect";

const suffix = nanoid(8);
const USER_ID = `usr-sync-${suffix}`;
const CUSTOMER_NAME = `ACME Rockets ${suffix}`;
const INSTANCE = `instance-${suffix}`;
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
/** The term a reissue extends to, which has to outrun the one it replaces. */
const LATER_YEAR = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function sync({
  token,
  instanceId = INSTANCE,
  body,
}: {
  token: string;
  instanceId?: string | null;
  body: unknown;
}) {
  return app.request("/api/connect/v1/license/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(instanceId ? { "X-LangWatch-Instance": instanceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/connect/v1/license/sync (real PG)", () => {
  const previousKey = process.env.LANGWATCH_LICENSE_PRIVATE_KEY;
  const organizationIds: string[] = [];
  const registry = new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    seatReports: new PrismaLicenseSeatReports(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: { sync: async () => undefined },
    signingKey: () => privateKey,
    publicKey,
    // The app's own encryption, because the route decrypts a held license with
    // the app's own `decrypt`. A stand-in here would never come back out.
    encrypt,
  });

  const issue = async (seats = 50) => {
    const { licenseKey, license } = await registry.issue({
      customer: { newOrganizationName: CUSTOMER_NAME },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: seats,
      expiresAt: NEXT_YEAR,
      operatorId: USER_ID,
    });
    organizationIds.push(license.organizationId as string);
    return {
      id: license.id,
      licenseId: license.licenseId,
      token: licenseTokenFromKey(licenseKey) as string,
    };
  };

  const seatsInUse = (members: number) => ({
    version: "1.42.0",
    seats: { members, liteMembers: 0 },
  });

  beforeAll(async () => {
    await startTestContainers();
    process.env.LANGWATCH_LICENSE_PRIVATE_KEY = privateKey;
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@sync.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    if (previousKey === undefined) {
      delete process.env.LANGWATCH_LICENSE_PRIVATE_KEY;
    } else {
      process.env.LANGWATCH_LICENSE_PRIVATE_KEY = previousKey;
    }
    const inOrganizations = { organizationId: { in: organizationIds } };
    const licenses = await prisma.issuedLicense.findMany({
      where: inOrganizations,
      select: { id: true },
    });
    await prisma.licenseSeatReport.deleteMany({
      where: { licenseId: { in: licenses.map((license) => license.id) } },
    });
    await prisma.issuedLicense.deleteMany({ where: inOrganizations });
    await prisma.gatewayChangeEvent.deleteMany({ where: inOrganizations });
    const keys = await prisma.virtualKey.findMany({
      where: inOrganizations,
      select: { id: true },
    });
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKeyId: { in: keys.map((key) => key.id) } },
    });
    await prisma.virtualKey.deleteMany({ where: inOrganizations });
    await prisma.auditLog.deleteMany({ where: inOrganizations });
    await prisma.project.deleteMany({ where: { team: inOrganizations } });
    await prisma.team.deleteMany({ where: inOrganizations });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  describe("given an active license registered to a customer", () => {
    describe("when the install syncs reporting the seats in use", () => {
      /** @scenario A sync records the reported seats and answers with a lease */
      it("records the seats and the time, and answers with a signed lease", async () => {
        const license = await issue();

        const res = await sync({
          token: license.token,
          body: { version: "1.42.0", seats: { members: 53, liteMembers: 2 } },
        });

        expect(res.status).toBe(200);
        const { lease } = (await res.json()) as { lease: unknown };
        const payload = verifyLease({
          lease,
          publicKey,
          licenseId: license.licenseId,
          instanceId: INSTANCE,
        });
        if (!payload)
          throw new Error("expected a lease this install can trust");
        expect(payload.seatOverageAllowance).toBe(10);
        const warnAfterDays =
          (new Date(payload.warnAfter).getTime() -
            new Date(payload.issuedAt).getTime()) /
          (24 * 60 * 60 * 1000);
        const validDays =
          (new Date(payload.validUntil).getTime() -
            new Date(payload.issuedAt).getTime()) /
          (24 * 60 * 60 * 1000);
        expect([warnAfterDays, validDays]).toEqual([14, 30]);

        const row = await prisma.issuedLicense.findUnique({
          where: { id: license.id },
        });
        expect(row).toMatchObject({
          lastSyncVersion: "1.42.0",
          reportedMembers: 53,
          reportedMembersLite: 2,
        });
        expect(row?.lastSyncAt).toBeInstanceOf(Date);
        expect(
          await prisma.licenseSeatReport.findMany({
            where: { licenseId: license.id },
          }),
        ).toMatchObject([{ peakMembers: 53, peakMembersLite: 2 }]);
      });

      it("keeps the quarter at its peak when a later report is lower", async () => {
        const license = await issue();

        await sync({
          token: license.token,
          body: { version: "1.42.0", seats: { members: 53, liteMembers: 0 } },
        });
        await sync({
          token: license.token,
          body: { version: "1.42.0", seats: { members: 51, liteMembers: 0 } },
        });

        expect(
          await prisma.licenseSeatReport.findMany({
            where: { licenseId: license.id },
          }),
        ).toMatchObject([{ peakMembers: 53 }]);
      });
    });

    describe("when a refused sync arrives", () => {
      it("answers the gateway's code and records nothing", async () => {
        const license = await issue(73);
        await sync({
          token: license.token,
          body: { version: "1.42.0", seats: { members: 1, liteMembers: 0 } },
        });

        const refusals = await Promise.all([
          sync({
            token: `lwl_${"0".repeat(64)}`,
            body: { version: "1.42.0", seats: { members: 1, liteMembers: 0 } },
          }),
          sync({
            token: license.token,
            instanceId: "another-install",
            body: { version: "1.42.0", seats: { members: 1, liteMembers: 0 } },
          }),
          sync({
            token: license.token,
            instanceId: null,
            body: { version: "1.42.0", seats: { members: 1, liteMembers: 0 } },
          }),
          sync({ token: license.token, body: { hostname: "acme.internal" } }),
        ]);
        const bodies = await Promise.all(
          refusals.map(async (res) => ({
            status: res.status,
            text: await res.text(),
          })),
        );

        expect(
          bodies.map(({ status, text }) => [
            status,
            (JSON.parse(text) as { error: { code: string } }).error.code,
          ]),
        ).toEqual([
          [401, "connect_license_not_registered"],
          [403, "connect_wrong_instance"],
          [400, "connect_instance_required"],
          [400, "validation_error"],
        ]);
        for (const { text } of bodies) {
          expect(text).not.toContain("ACME");
          expect(text).not.toContain("73");
        }
        expect(
          await prisma.licenseSeatReport.findMany({
            where: { licenseId: license.id },
          }),
        ).toMatchObject([{ peakMembers: 1 }]);
      });
    });
  });

  describe("given LangWatch reissued the license with 80 seats", () => {
    describe("when the install syncs, applies it, and syncs with the new one", () => {
      /** @scenario A reissued license arrives over sync and is applied */
      it("delivers a license that reads 80 seats and retires the one it replaces", async () => {
        const original = await issue(50);
        await sync({ token: original.token, body: seatsInUse(50) });
        const { licenseKey: reissued } = await registry.reissue({
          id: original.id,
          maxMembers: 80,
          expiresAt: LATER_YEAR,
          operatorId: USER_ID,
        });

        const delivery = await sync({
          token: original.token,
          body: seatsInUse(50),
        });
        const { license } = (await delivery.json()) as { license?: string };

        expect(delivery.status).toBe(200);
        expect(license).toBe(reissued);
        // The install's own path: the same check `validateLicense` runs inside
        // a deployment before it stores the key it was handed.
        const applied = validateLicense({
          licenseKey: license as string,
          publicKey,
        });
        expect(applied).toMatchObject({
          valid: true,
          planInfo: { maxMembers: 80 },
        });

        const inUse = await sync({
          token: licenseTokenFromKey(reissued) as string,
          body: seatsInUse(60),
        });
        expect(inUse.status).toBe(200);
        expect(
          await prisma.issuedLicense.findUnique({ where: { id: original.id } }),
        ).toMatchObject({ supersededAt: expect.any(Date) });
        const afterwards = await sync({
          token: original.token,
          body: seatsInUse(60),
        });
        expect([
          afterwards.status,
          ((await afterwards.json()) as { error: { code: string } }).error.code,
        ]).toEqual([403, "connect_license_revoked"]);
      });
    });
  });
});
