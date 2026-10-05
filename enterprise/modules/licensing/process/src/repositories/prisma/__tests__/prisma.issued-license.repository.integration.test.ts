import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-credential.feature
 *
 * The license registry against a real Postgres: the rules the table's own
 * constraints and conditional writes decide, not the service's checks.
 */
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../../__tests__/fixtures/license-keys.fixture.ts";
import { LicenseRegistryService } from "../../../services/license-registry.service.ts";
import { PrismaIssuedLicenseRepository } from "../prisma.issued-license.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "./support/licensing-database.fixture.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const RUN = `lic-reg-${crypto.randomUUID().slice(0, 8)}`;

/** Marks what reached the column, so a suite can see the row was sealed at rest. */
const SEALING = {
  encrypt: (plaintext: string) => `sealed:${plaintext}`,
  decrypt: (ciphertext: string) => ciphertext.slice("sealed:".length),
};

describe.skipIf(!TEST_DATABASE_URL)("the license registry on Postgres", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  const repository = PrismaIssuedLicenseRepository.create(prisma, SEALING);
  const organizationIds: string[] = [];
  const organizationNames = new Map<string, string>();
  const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
  const registry = LicenseRegistryService.create({
    repository,
    organizations: {
      findById: async (id) => ({ id, name: organizationNames.get(id) ?? "" }),
      createSelfHostedCustomer: async () => {
        throw new Error("these suites issue to organizations they created");
      },
      markSelfHostedCustomer: async () => undefined,
    },
    managedKeys: {
      provision: async () => ({ id: `vk_${RUN}` }),
      retire: async () => undefined,
      invalidate: async () => undefined,
      setConnectServices: async () => undefined,
      setLicense: async () => undefined,
    },
    contractBudgets: { sync: async () => undefined },
    cryptography,
    generation: LicenseGenerationService.create(cryptography),
    signingKey: () => TEST_PRIVATE_KEY,
    now: () => nowInstant(),
  });

  async function issue(label: string) {
    const organization = await prisma.organization.create({
      data: { name: `${label} ${RUN}`, slug: `--${RUN}-${organizationIds.length}` },
    });
    organizationIds.push(organization.id);
    organizationNames.set(organization.id, organization.name);
    return registry.issue({
      customer: { organizationId: organization.id },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: nowInstant().add({ hours: 24 * 365 }),
      operatorId: "user_operator",
    });
  }

  afterAll(async () => {
    await prisma.issuedLicense.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  it("stores a new row with its defaults and finds it by the token hash", async () => {
    const { license } = await issue("ACME Defaults");
    const stored = await prisma.issuedLicense.findUnique({ where: { id: license.id } });

    expect(stored).toMatchObject({
      services: [],
      commitUsdCents: 0,
      overageEnabled: false,
      instanceId: null,
      revokedAt: null,
    });
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await repository.findByTokenHash(stored?.tokenHash ?? ""))?.id).toBe(license.id);
  });

  it("records a raised seat change in the replacement's own insert and reads it back", async () => {
    const { license } = await issue("ACME Seats");
    const changed = await registry.changeSeats({
      id: license.id,
      maxMembers: 58,
      operatorId: "user_operator",
    });

    const stored = await prisma.issuedLicense.findUnique({ where: { id: changed.license.id } });
    expect(stored?.seatsRaisedFrom).toBe(50);
    await expect(
      registry.findSeatChanges({ organizationId: license.organizationId ?? "" }),
    ).resolves.toMatchObject([{ licenseRowId: changed.license.id, previousSeats: 50, seats: 58 }]);
  });

  /** @scenario A reissued license is held encrypted only until it is delivered */
  it("seals a reissued license at rest and reads it back opened", async () => {
    const { license } = await issue("ACME Sealed");
    const changed = await registry.changeSeats({
      id: license.id,
      maxMembers: 60,
      operatorId: "user_operator",
    });

    const stored = await prisma.issuedLicense.findUnique({ where: { id: changed.license.id } });
    expect(stored?.pendingDeliveryLicense).toBe(`sealed:${changed.licenseKey}`);
    const read = await repository.findByReplacesId(license.id);
    expect(read?.pendingDeliveryLicense).toBe(changed.licenseKey);
  });

  it("refuses a second reissue of the same license from the table's own unique constraint", async () => {
    const { license } = await issue("ACME Reissue");
    const expiresAt = nowInstant().add({ hours: 24 * 365 });
    await registry.reissue({
      id: license.id,
      maxMembers: 80,
      expiresAt,
      operatorId: "user_operator",
    });

    await expect(
      registry.reissue({ id: license.id, maxMembers: 90, expiresAt, operatorId: "user_operator" }),
    ).rejects.toMatchObject({ code: "license_already_reissued" });
    expect(await prisma.issuedLicense.count({ where: { replacesId: license.id } })).toBe(1);
  });

  /** @scenario "The managed key is recorded only while the license still admits the call" */
  it("refuses to record a managed key against a license revoked meanwhile", async () => {
    const { license } = await issue("ACME Attach Revoked");
    await prisma.issuedLicense.update({
      where: { id: license.id },
      data: { instanceId: "instance-a", revokedAt: new Date(), revokedReason: "leaked" },
    });

    const attached = await repository.attachVirtualKey({
      id: license.id,
      virtualKeyId: `vk_${RUN}_revoked`,
      requires: {
        organizationId: license.organizationId ?? "",
        instanceId: "instance-a",
        activeAt: nowInstant(),
      },
    });

    expect(attached).toBe(false);
    expect(
      (await prisma.issuedLicense.findUnique({ where: { id: license.id } }))?.virtualKeyId,
    ).toBeNull();
  });

  /** @scenario "The managed key is recorded only while the license still admits the call" */
  it("refuses an attach parked behind a revocation that commits first", async () => {
    const { license } = await issue("ACME Attach Interleaving");
    await prisma.issuedLicense.update({
      where: { id: license.id },
      data: { instanceId: "instance-a" },
    });

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
        PrismaIssuedLicenseRepository.create(tx, SEALING).attachVirtualKey({
          id: license.id,
          virtualKeyId: `vk_${RUN}_interleaved`,
          requires: {
            organizationId: license.organizationId ?? "",
            instanceId: "instance-a",
            activeAt: nowInstant(),
          },
        }),
    });

    expect(answers.second).toBe(false);
    expect(
      (await prisma.issuedLicense.findUnique({ where: { id: license.id } }))?.virtualKeyId,
    ).toBeNull();
  });

  /** @scenario "Two instances racing to bind leave exactly one bound" */
  it("binds the first of two installs and refuses the one waiting on the row", async () => {
    const { license } = await issue("ACME Bind Race");
    const at = nowInstant();
    const bindFor = (instanceId: string) => (tx: Prisma.TransactionClient) =>
      PrismaIssuedLicenseRepository.create(tx, SEALING).bindInstance({
        id: license.id,
        instanceId,
        at,
      });

    const binds = await raceOnOneRow({
      prisma,
      table: "IssuedLicense",
      first: bindFor("instance-first"),
      second: bindFor("instance-second"),
    });

    expect(binds).toEqual({ first: true, second: false });
    expect((await prisma.issuedLicense.findUnique({ where: { id: license.id } }))?.instanceId).toBe(
      "instance-first",
    );
  });

  it("matches the list search on the customer name without regard to case", async () => {
    await issue("Zebra Logistics");

    const { rows, total } = await repository.listAll({
      page: 0,
      pageSize: 25,
      search: `zebra logistics ${RUN}`.toUpperCase(),
    });

    expect(total).toBe(1);
    expect(rows[0]?.organizationName).toContain("Zebra Logistics");
  });
});
