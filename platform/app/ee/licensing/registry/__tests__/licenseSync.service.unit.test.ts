import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LEASE_VALID_DAYS,
  LEASE_WARN_AFTER_DAYS,
  verifyLease,
} from "../../connect/lease";
import { licenseTokenFromKey } from "../../licenseToken";
import { ConnectCredentialService } from "../connectCredential.service";
import { LicenseRegistryService } from "../licenseRegistry.service";
import { LicenseSyncService } from "../licenseSync.service";
import {
  InMemoryConnectManagedKeys,
  InMemoryCustomerOrganizations,
  InMemoryIssuedLicenseRepository,
  InMemoryLicenseSeatReports,
  RecordingContractBudgets,
} from "./registryFakes";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const NEXT_YEAR = new Date("2027-09-19T12:00:00.000Z");
const OPERATOR = "user_operator";
const SYSTEM = "system:connect-license";
const INSTANCE = "org_install";
const DAY_MS = 24 * 60 * 60 * 1000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** The held copy is reversible in the test, so delivery can be asserted on. */
const encrypt = (plain: string) => `enc:${plain}`;
const decrypt = (cipher: string) => cipher.replace(/^enc:/, "");

function build({ syncsAllowed = Number.POSITIVE_INFINITY } = {}) {
  let now = NOW;
  let syncs = 0;
  const repository = new InMemoryIssuedLicenseRepository(NOW);
  const seatReports = new InMemoryLicenseSeatReports();
  const organizations = new InMemoryCustomerOrganizations();
  const managedKeys = new InMemoryConnectManagedKeys();
  const registry = new LicenseRegistryService({
    repository,
    seatReports,
    organizations,
    managedKeys,
    contractBudgets: new RecordingContractBudgets(),
    signingKey: () => privateKey,
    publicKey,
    encrypt,
    now: () => now,
  });
  const sync = new LicenseSyncService({
    credentials: new ConnectCredentialService({
      repository,
      managedKeys,
      systemActorId: SYSTEM,
      now: () => now,
    }),
    repository,
    seatReports,
    managedKeys,
    rateLimit: { allow: async () => ++syncs <= syncsAllowed },
    signingKey: () => privateKey,
    decrypt,
    systemActorId: SYSTEM,
    now: () => now,
  });
  return {
    repository,
    seatReports,
    organizations,
    managedKeys,
    registry,
    sync,
    travelTo: (date: Date) => {
      now = date;
    },
  };
}

const seatsBody = (members: number, liteMembers = 0) => ({
  version: "1.42.0",
  seats: { members, liteMembers },
});

describe("LicenseSyncService", () => {
  let context: ReturnType<typeof build>;
  let acme: string;

  const issue = async (maxMembers = 50) => {
    const { licenseKey, license } = await context.registry.issue({
      customer: { organizationId: acme },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers,
      expiresAt: NEXT_YEAR,
      operatorId: OPERATOR,
    });
    return {
      id: license.id,
      licenseId: license.licenseId,
      licenseKey,
      token: licenseTokenFromKey(licenseKey) as string,
    };
  };

  const syncWith = (token: string, body: unknown, instanceId = INSTANCE) =>
    context.sync.recordSync({ token, instanceId, body });

  beforeEach(() => {
    context = build();
    acme = context.organizations.seed("ACME");
  });

  describe("given an active license registered to a customer", () => {
    describe("when the install syncs reporting the seats in use", () => {
      it("records the report and answers with a lease for this license and instance", async () => {
        const license = await issue();

        const result = await syncWith(license.token, seatsBody(53, 4));

        if (!result.ok) throw new Error(`refused: ${result.code}`);
        const payload = verifyLease({
          lease: result.lease,
          publicKey,
          licenseId: license.licenseId,
          instanceId: INSTANCE,
        });
        expect(payload).toMatchObject({
          seatOverageAllowance: 10,
          issuedAt: NOW.toISOString(),
          warnAfter: new Date(
            NOW.getTime() + LEASE_WARN_AFTER_DAYS * DAY_MS,
          ).toISOString(),
          validUntil: new Date(
            NOW.getTime() + LEASE_VALID_DAYS * DAY_MS,
          ).toISOString(),
        });
        expect(await context.repository.findById(license.id)).toMatchObject({
          lastSyncAt: NOW,
          lastSyncVersion: "1.42.0",
          reportedMembers: 53,
          reportedMembersLite: 4,
        });
      });

      it("carries the services the license is entitled to", async () => {
        const license = await issue();
        await context.registry.updateTerms({
          id: license.id,
          operatorId: OPERATOR,
          services: ["instant_evals"],
        });

        const result = await syncWith(license.token, seatsBody(1));

        if (!result.ok) throw new Error(`refused: ${result.code}`);
        expect(result.lease.payload.services).toEqual(["instant_evals"]);
      });

      it("answers with the allowance an operator set on the row", async () => {
        const license = await issue();
        await context.registry.updateTerms({
          id: license.id,
          operatorId: OPERATOR,
          seatOverageAllowance: 3,
        });

        const result = await syncWith(license.token, seatsBody(1));

        if (!result.ok) throw new Error(`refused: ${result.code}`);
        expect(result.lease.payload.seatOverageAllowance).toBe(3);
      });
    });

    describe("when the install reports a lower count later in the same quarter", () => {
      /** @scenario The highest seat count of the quarter is what is kept for billing */
      it("keeps the highest figure of that quarter", async () => {
        const license = await issue();

        await syncWith(license.token, seatsBody(53, 7));
        context.travelTo(new Date("2026-10-20T12:00:00.000Z"));
        await syncWith(license.token, seatsBody(51, 2));

        expect(context.seatReports.rows).toMatchObject([
          {
            licenseId: license.id,
            quarterStartsAt: NOW,
            peakMembers: 53,
            peakMembersLite: 7,
            firstReportedAt: NOW,
            lastReportedAt: new Date("2026-10-20T12:00:00.000Z"),
          },
        ]);
      });

      it("opens a new row once the term quarter turns over", async () => {
        const license = await issue();

        await syncWith(license.token, seatsBody(53));
        context.travelTo(new Date("2026-12-19T12:00:00.000Z"));
        await syncWith(license.token, seatsBody(51));

        expect(
          context.seatReports.rows.map((row) => [
            row.quarterStartsAt.toISOString(),
            row.peakMembers,
          ]),
        ).toEqual([
          ["2026-09-19T12:00:00.000Z", 53],
          ["2026-12-19T12:00:00.000Z", 51],
        ]);
      });
    });

    describe("when the same license syncs far more often than once a day", () => {
      /** @scenario Sync is rate limited per license */
      it("refuses the extra syncs and records nothing for them", async () => {
        context = build({ syncsAllowed: 1 });
        acme = context.organizations.seed("ACME");
        const license = await issue();

        const first = await syncWith(license.token, seatsBody(53));
        const second = await syncWith(license.token, seatsBody(99));

        expect(first.ok).toBe(true);
        expect(second).toEqual({ ok: false, code: "rate_limited" });
        expect(context.seatReports.rows[0]?.peakMembers).toBe(53);
        expect(
          (await context.repository.findById(license.id))?.reportedMembers,
        ).toBe(53);
      });
    });

    describe("when a sync arrives with seat counts that are not whole non-negative numbers", () => {
      /** @scenario A sync with a malformed payload is refused */
      it("refuses it as invalid and records nothing", async () => {
        const license = await issue();

        const refusals = await Promise.all([
          syncWith(license.token, {
            version: "1.0.0",
            seats: { members: -1, liteMembers: 0 },
          }),
          syncWith(license.token, {
            version: "1.0.0",
            seats: { members: 1.5, liteMembers: 0 },
          }),
          syncWith(license.token, { version: "1.0.0", seats: { members: 1 } }),
          syncWith(license.token, { version: "1.0.0" }),
          syncWith(license.token, null),
        ]);

        expect(refusals).toEqual(
          refusals.map(() => ({ ok: false, code: "validation_error" })),
        );
        expect(context.seatReports.rows).toEqual([]);
        expect(
          (await context.repository.findById(license.id))?.lastSyncAt,
        ).toBeNull();
      });

      it("refuses a body that carries anything beyond the version and the seats", async () => {
        const license = await issue();

        const result = await syncWith(license.token, {
          ...seatsBody(3),
          hostname: "acme.internal",
        });

        expect(result).toEqual({ ok: false, code: "validation_error" });
      });
    });
  });

  describe("given licenses that are unregistered, revoked or bound elsewhere", () => {
    describe("when each of them syncs", () => {
      /** @scenario A sync from an unregistered, revoked or wrong-instance license is refused */
      it("refuses with the codes the gateway uses and records no seats", async () => {
        const revoked = await issue();
        await context.registry.revoke({
          id: revoked.id,
          operatorId: OPERATOR,
          reason: "leaked",
        });
        const bound = await issue();
        await syncWith(bound.token, seatsBody(1));
        const expired = await issue();

        const withinTheTerm = await Promise.all([
          syncWith(`lwl_${"0".repeat(64)}`, seatsBody(1)),
          syncWith(revoked.token, seatsBody(1)),
          syncWith(bound.token, seatsBody(1), "another-install"),
          context.sync.recordSync({
            token: bound.token,
            instanceId: undefined,
            body: seatsBody(1),
          }),
        ]);
        context.travelTo(new Date("2027-09-20T12:00:00.000Z"));
        const refusals = [
          ...withinTheTerm.slice(0, 3),
          await syncWith(expired.token, seatsBody(1)),
          withinTheTerm[3],
        ];

        expect(refusals).toEqual([
          { ok: false, code: "connect_license_not_registered" },
          { ok: false, code: "connect_license_revoked" },
          { ok: false, code: "connect_wrong_instance" },
          { ok: false, code: "connect_license_expired" },
          { ok: false, code: "connect_instance_required" },
        ]);
        expect(context.seatReports.rows).toHaveLength(1);
        expect(context.seatReports.rows[0]?.licenseId).toBe(bound.id);
      });
    });
  });

  describe("given a license that was reissued and is waiting for its install to pick it up", () => {
    const reissue = async () => {
      const original = await issue();
      await syncWith(original.token, seatsBody(50));
      const { licenseKey, license } = await context.registry.reissue({
        id: original.id,
        maxMembers: 80,
        expiresAt: new Date("2028-09-19T12:00:00.000Z"),
        operatorId: OPERATOR,
      });
      return {
        original,
        replacement: {
          id: license.id,
          token: licenseTokenFromKey(licenseKey) as string,
        },
        licenseKey,
      };
    };

    describe("when the install syncs with the license it still holds", () => {
      /** @scenario A reissued license is held encrypted only until it is delivered */
      it("holds the new license encrypted and hands it over on that sync", async () => {
        const { original, licenseKey, replacement } = await reissue();

        expect(
          (await context.repository.findById(replacement.id))
            ?.pendingDeliveryLicense,
        ).toBe(encrypt(licenseKey));
        const result = await syncWith(original.token, seatsBody(50));

        if (!result.ok) throw new Error(`refused: ${result.code}`);
        expect(result.license).toBe(licenseKey);
      });

      it("keeps handing it over until the install presents the new one", async () => {
        const { original, licenseKey } = await reissue();

        await syncWith(original.token, seatsBody(50));
        const again = await syncWith(original.token, seatsBody(50));

        if (!again.ok) throw new Error(`refused: ${again.code}`);
        expect(again.license).toBe(licenseKey);
      });
    });

    describe("when the install syncs with the new license", () => {
      /** @scenario The replaced license is retired once the new one is in use */
      it("supersedes the replaced license, ends its key and erases the held copy", async () => {
        const { original, replacement } = await reissue();
        const replacedKey = (await context.repository.findById(original.id))
          ?.virtualKeyId;

        const result = await syncWith(replacement.token, seatsBody(60));

        expect(result.ok).toBe(true);
        expect(await context.repository.findById(original.id)).toMatchObject({
          supersededAt: NOW,
        });
        expect(context.managedKeys.active()).not.toContain(replacedKey);
        expect(
          (await context.repository.findById(replacement.id))
            ?.pendingDeliveryLicense,
        ).toBeNull();
      });

      it("refuses the replaced license from then on", async () => {
        const { original, replacement } = await reissue();

        await syncWith(replacement.token, seatsBody(60));

        expect(await syncWith(original.token, seatsBody(60))).toEqual({
          ok: false,
          code: "connect_license_revoked",
        });
      });

      it("answers no license once the delivery is done", async () => {
        const { replacement } = await reissue();

        await syncWith(replacement.token, seatsBody(60));
        const again = await syncWith(replacement.token, seatsBody(60));

        if (!again.ok) throw new Error(`refused: ${again.code}`);
        expect(again.license).toBeUndefined();
      });
    });
  });
});
