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
import { raceOnOneRow } from "@langwatch/test-harness/row-lock-race";
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
      recordSelfHostedCustomerLicensed: async () => undefined,
    },
    managedKeys: {
      issue: async () => undefined,
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

  async function issue(label: string, email = "ops@acme.test") {
    const organization = await prisma.organization.create({
      data: { name: `${label} ${RUN}`, slug: `--${RUN}-${organizationIds.length}` },
    });
    organizationIds.push(organization.id);
    organizationNames.set(organization.id, organization.name);
    return registry.issue({
      customer: { organizationId: organization.id },
      email,
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

  /** @scenario A purchased GROWTH licence is recorded with unlimited lite seats */
  it("stores a GROWTH license's unlimited lite seats as the flag, not an overflowing count", async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME Growth ${RUN}`, slug: `--${RUN}-${organizationIds.length}` },
    });
    organizationIds.push(organization.id);
    const { license } = await registry.issue({
      customer: { organizationId: organization.id },
      email: "ops@acme.test",
      planType: "GROWTH",
      maxMembers: 5,
      expiresAt: nowInstant().add({ hours: 24 * 365 }),
      operatorId: "user_operator",
    });
    const stored = await prisma.issuedLicense.findUnique({ where: { id: license.id } });

    expect(stored).toMatchObject({ maxMembersLite: null, liteSeatsUnlimited: true });
  });

  /** @scenario A replacement keeps the Developer seats of the licence it replaces */
  it("stores the Developer seats and keeps them on a reissue", async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME Developers ${RUN}`, slug: `--${RUN}-${organizationIds.length}` },
    });
    organizationIds.push(organization.id);
    const { license } = await registry.issue({
      customer: { organizationId: organization.id },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 5,
      maxMembersDeveloper: 4,
      expiresAt: nowInstant().add({ hours: 24 * 365 }),
      operatorId: "user_operator",
    });
    const reissued = await registry.reissue({
      id: license.id,
      expiresAt: nowInstant().add({ hours: 24 * 730 }),
      operatorId: "user_operator",
    });

    const rows = await prisma.issuedLicense.findMany({
      where: { id: { in: [license.id, reissued.license.id] } },
      select: { maxMembersDeveloper: true },
    });
    expect(rows).toEqual([{ maxMembersDeveloper: 4 }, { maxMembersDeveloper: 4 }]);
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

  /** @scenario "The registry revokes an unbound license and refuses to bind a revoked one in single writes" */
  it("lets one of a racing unused-key revoke and a bind win, in either order", async () => {
    const at = nowInstant();
    const revokeOf = (id: string) => (tx: Prisma.TransactionClient) =>
      PrismaIssuedLicenseRepository.create(tx, SEALING).revokeUnbound({
        id,
        at,
        revokedById: "user_operator",
        revokedReason: "unused",
      });
    const bindOf = (id: string) => (tx: Prisma.TransactionClient) =>
      PrismaIssuedLicenseRepository.create(tx, SEALING).bindInstance({
        id,
        instanceId: "instance-a",
        at,
      });

    const revokedFirst = (await issue("ACME Revoke Then Bind")).license;
    expect(
      await raceOnOneRow({
        prisma,
        table: "IssuedLicense",
        first: revokeOf(revokedFirst.id),
        second: bindOf(revokedFirst.id),
      }),
    ).toEqual({ first: true, second: false });
    const revokedRow = await prisma.issuedLicense.findUnique({ where: { id: revokedFirst.id } });
    expect(revokedRow?.revokedAt).not.toBeNull();
    expect(revokedRow?.instanceId).toBeNull();

    const boundFirst = (await issue("ACME Bind Then Revoke")).license;
    expect(
      await raceOnOneRow({
        prisma,
        table: "IssuedLicense",
        first: bindOf(boundFirst.id),
        second: revokeOf(boundFirst.id),
      }),
    ).toEqual({ first: true, second: false });
    const boundRow = await prisma.issuedLicense.findUnique({ where: { id: boundFirst.id } });
    expect(boundRow?.instanceId).toBe("instance-a");
    expect(boundRow?.revokedAt).toBeNull();
  });

  /** @scenario "A revoke ends a key that attached while it ran" */
  it("revokes a license only while it still names the key the caller ended", async () => {
    const { license } = await issue("ACME Holding Key");
    const repository = PrismaIssuedLicenseRepository.create(prisma, SEALING);
    const mark = (virtualKeyId: string | null) =>
      repository.revokeHolding({
        id: license.id,
        virtualKeyId,
        at: nowInstant(),
        revokedById: "op",
        revokedReason: "leaked",
      });
    await repository.update(license.id, { virtualKeyId: "vk-new" });

    expect(await mark(null)).toBe(false);
    expect((await repository.findById(license.id))?.revokedAt).toBeNull();
    expect(await mark("vk-new")).toBe(true);
    expect(await mark("vk-new")).toBe(false);
  });

  /** @scenario "Only a live license lets go of an ended managed key" */
  it("lets go of an ended key on the live license naming it, never on a revoked one", async () => {
    const live = (await issue("ACME Release Key")).license;
    const revoked = (await issue("ACME Revoked Key")).license;
    const repository = PrismaIssuedLicenseRepository.create(prisma, SEALING);
    await repository.update(live.id, { virtualKeyId: "vk-ended-live" });
    await repository.update(revoked.id, {
      virtualKeyId: "vk-ended-revoked",
      revokedAt: nowInstant(),
    });

    expect(await repository.releaseVirtualKey({ virtualKeyId: "vk-other" })).toBe(false);
    expect(await repository.releaseVirtualKey({ virtualKeyId: "vk-ended-revoked" })).toBe(false);
    expect(await repository.releaseVirtualKey({ virtualKeyId: "vk-ended-live" })).toBe(true);

    expect((await repository.findById(live.id))?.virtualKeyId).toBeNull();
    expect((await repository.findById(revoked.id))?.virtualKeyId).toBe("vk-ended-revoked");
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

  /** @scenario The license list filters by status and by who the license is for */
  it("keeps active or inactive licences, and internal addresses or the rest case aside", async () => {
    const tag = `Filters ${RUN}`;
    const { license: active } = await issue(`${tag} active`, "ops@customer.com");
    const { license: revoked } = await issue(`${tag} revoked`, "it@customer.com");
    const { license: superseded } = await issue(`${tag} superseded`, "it@customer.com");
    const { license: expired } = await issue(`${tag} expired`, "it@customer.com");
    const { license: internal } = await issue(`${tag} internal`, "Dogfood@LangWatch.AI");
    const now = nowInstant();
    await repository.update(revoked.id, { revokedAt: now, revokedReason: "test" });
    await repository.update(superseded.id, { supersededAt: now });
    await repository.update(expired.id, { expiresAt: now.subtract({ hours: 1 }) });
    const query = { page: 0, pageSize: 25, search: tag };
    const ids = (page: { rows: { id: string }[] }) => page.rows.map((row) => row.id).toSorted();
    const internalOnes = (matching: boolean) => ({
      emailSuffixes: { suffixes: ["@langwatch.ai"], matching },
    });

    const everything = await repository.listAll(query);
    const onlyActive = await repository.listAll({ ...query, status: { at: now, active: true } });
    const inactive = await repository.listAll({ ...query, status: { at: now, active: false } });
    const external = await repository.listAll({
      ...query,
      status: { at: now, active: true },
      ...internalOnes(false),
    });

    expect(everything.total).toBe(5);
    expect(ids(onlyActive)).toEqual([active.id, internal.id].toSorted());
    expect(ids(inactive)).toEqual([revoked.id, superseded.id, expired.id].toSorted());
    expect(ids(external)).toEqual([active.id]);
    expect(external.total).toBe(1);
    expect(await repository.countAll({ search: tag, ...internalOnes(true) })).toBe(1);
  });

  /** @scenario "The registry lists and counts a reissue chain once" */
  it("leaves out a license an unrevoked one replaces, and keeps one whose replacement was revoked", async () => {
    const tag = `Chains ${RUN}`;
    const { license: extended } = await issue(`${tag} extended`);
    const { license: kept } = await issue(`${tag} kept`);
    const later = nowInstant().add({ hours: 24 * 400 });
    const replacement = await registry.reissue({
      id: extended.id,
      expiresAt: later,
      operatorId: "user_operator",
    });
    const withdrawn = await registry.reissue({
      id: kept.id,
      expiresAt: later,
      operatorId: "user_operator",
    });
    await repository.update(withdrawn.license.id, {
      revokedAt: nowInstant(),
      revokedReason: "test",
    });
    const query = { page: 0, pageSize: 25, search: tag, chainHeadsOnly: true };

    const heads = await repository.listAll(query);

    expect(heads.rows.map((row) => row.id).toSorted()).toEqual(
      [replacement.license.id, kept.id, withdrawn.license.id].toSorted(),
    );
    expect(heads.total).toBe(3);
    expect(await repository.countAll({ search: tag, chainHeadsOnly: true })).toBe(3);
    expect(await repository.countAll({ search: tag })).toBe(4);
  });
});
