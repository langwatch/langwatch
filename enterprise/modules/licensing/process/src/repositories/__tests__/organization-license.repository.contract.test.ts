// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The licence rows answer alike over their memory twin and over Postgres (the Postgres half
 * runs when LANGWATCH_TEST_DATABASE_URL names a database).
 * Spec: enterprise/modules/licensing/specs/licensing.feature
 */
import { randomUUID } from "node:crypto";

import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import { fromDate, toDate, type Instant } from "@langwatch/time";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryOrganizationLicenseRepository } from "../memory/memory.organization-license.repository.ts";
import type {
  LicenseColumns,
  OrganizationLicensePair,
  OrganizationLicenseRepository,
} from "../organization-license.repository.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "../prisma/__tests__/support/licensing-database.fixture.ts";
import { PrismaOrganizationLicenseRepository } from "../prisma/prisma.organization-license.repository.ts";

type Seed = Readonly<{
  licenseKey: string | null;
  expiresAt?: Instant | null;
  validatedAt?: Instant | null;
  updatedAt?: Instant;
}>;

type Backend = Readonly<{
  /** Organizations named `<prefix><suffix>` holding the given columns, and the repository over them. */
  seed: (input: Readonly<Record<string, Seed>>) => Promise<OrganizationLicenseRepository>;
  /** Writes organization's columns, standing in for organization mirroring a licence. */
  writeColumns: (input: Readonly<{ organizationId: string; columns: Seed }>) => Promise<void>;
  prefix: () => string;
}>;

const EXPIRES = fromDate(new Date("2031-02-03T04:05:06.000Z"));
const VALIDATED = fromDate(new Date("2030-01-02T03:04:05.000Z"));
/** Organization's row written after any row the cases save. */
const LATER = fromDate(new Date("2099-01-01T00:00:00.000Z"));

/** Instants compare by value, so the cases read them as strings. */
const view = (columns: LicenseColumns | null) =>
  columns === null
    ? null
    : {
        licenseKey: columns.licenseKey,
        expiresAt: columns.expiresAt?.toString() ?? null,
        validatedAt: columns.validatedAt?.toString() ?? null,
      };

const viewPair = (pair: OrganizationLicensePair) => ({
  organizationId: pair.organizationId,
  columns: view(pair.columns),
  own: view(pair.own),
});

function contractCases(backend: Backend): void {
  const id = (suffix: string) => `${backend.prefix()}${suffix}`;
  const mine = (id: string) => id.startsWith(backend.prefix());

  it("reads an organization's own columns while no row of licensing's exists", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: "column-key" } });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({
      licenseKey: "column-key",
    });
    const scanned = await repository.findOrganizationsWithLicense();
    expect(scanned).toContainEqual({ organizationId: id("a"), licenseKey: "column-key" });
  });

  it("answers no key for an organization holding none, and leaves it out of the scan", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: null } });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({ licenseKey: null });
    const scanned = await repository.findOrganizationsWithLicense();
    expect(scanned.filter(({ organizationId }) => mine(organizationId))).toEqual([]);
  });

  it("refuses an organization that does not exist", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: null } });

    await expect(repository.getOrganizationLicense(id("missing"))).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
    await expect(repository.organizationExists(id("missing"))).resolves.toBe(false);
    await expect(repository.organizationExists(id("a"))).resolves.toBe(true);
  });

  it("prefers the stored licence over the column's, scan included", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: "column-key" } });

    await repository.saveLicense({
      organizationId: id("a"),
      license: { licenseKey: "own-key", expiresAt: EXPIRES, validatedAt: VALIDATED },
    });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({
      licenseKey: "own-key",
    });
    const scanned = (await repository.findOrganizationsWithLicense()).filter(({ organizationId }) =>
      mine(organizationId),
    );
    expect(scanned).toEqual([{ organizationId: id("a"), licenseKey: "own-key" }]);
  });

  it("reads organization's columns where they were written after the row, scan included", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: "column-key" },
      [id("b")]: { licenseKey: "column-key" },
    });
    const own = { licenseKey: "own-key", expiresAt: EXPIRES, validatedAt: null };
    await repository.saveLicense({ organizationId: id("a"), license: own });
    await repository.saveLicense({ organizationId: id("b"), license: own });

    await backend.writeColumns({
      organizationId: id("a"),
      columns: { licenseKey: "newer-key", updatedAt: LATER },
    });
    await backend.writeColumns({
      organizationId: id("b"),
      columns: { licenseKey: null, updatedAt: LATER },
    });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({
      licenseKey: "newer-key",
    });
    await expect(repository.getOrganizationLicense(id("b"))).resolves.toEqual({ licenseKey: null });
    const scanned = (await repository.findOrganizationsWithLicense()).filter(({ organizationId }) =>
      mine(organizationId),
    );
    expect(scanned).toEqual([{ organizationId: id("a"), licenseKey: "newer-key" }]);
  });

  it("keeps a cleared licence cleared, never reading the column's key back", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: "column-key" } });
    await repository.saveLicense({
      organizationId: id("a"),
      license: { licenseKey: "own-key", expiresAt: EXPIRES, validatedAt: null },
    });

    await repository.clearLicense({ organizationId: id("a") });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({ licenseKey: null });
    const scanned = await repository.findOrganizationsWithLicense();
    expect(scanned.filter(({ organizationId }) => mine(organizationId))).toEqual([]);
    const [pair] = await repository.findLicensePairs({
      afterOrganizationId: backend.prefix(),
      limit: 1,
    });
    expect(viewPair(pair as OrganizationLicensePair).own).toEqual({
      licenseKey: null,
      expiresAt: null,
      validatedAt: null,
    });
  });

  it("restores the row read before a write, and deletes one that was not there", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: null },
      [id("b")]: { licenseKey: "column-key" },
    });
    const before = { licenseKey: "old-key", expiresAt: EXPIRES, validatedAt: VALIDATED };
    const written = { licenseKey: "new-key", expiresAt: EXPIRES, validatedAt: null };
    await repository.saveLicense({ organizationId: id("a"), license: before });
    const [previous = null] = await repository.findLicense({ organizationId: id("a") });
    await repository.saveLicense({ organizationId: id("a"), license: written });
    await repository.saveLicense({ organizationId: id("b"), license: written });

    await repository.restoreLicense({ organizationId: id("a"), written, previous });
    await repository.restoreLicense({ organizationId: id("b"), written, previous: null });

    const restored = await repository.findLicense({ organizationId: id("a") });
    expect(restored.map(view)).toEqual([view(before)]);
    await expect(repository.findLicense({ organizationId: id("b") })).resolves.toEqual([]);
    await expect(repository.getOrganizationLicense(id("b"))).resolves.toEqual({
      licenseKey: "column-key",
    });
  });

  it("keeps a row written again after the write it would undo", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: null } });
    const written = { licenseKey: "first-key", expiresAt: EXPIRES, validatedAt: null };
    const newer = { licenseKey: "second-key", expiresAt: EXPIRES, validatedAt: null };
    await repository.saveLicense({ organizationId: id("a"), license: written });
    await repository.saveLicense({ organizationId: id("a"), license: newer });

    await repository.restoreLicense({ organizationId: id("a"), written, previous: null });

    const kept = await repository.findLicense({ organizationId: id("a") });
    expect(kept.map(view)).toEqual([view(newer)]);
  });

  it("clears an organization that had no row of licensing's yet", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: "column-key" } });

    await repository.clearLicense({ organizationId: id("a") });

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({ licenseKey: null });
  });

  it("pages organizations in id order beside their rows, with their dates", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: "key-a", expiresAt: EXPIRES, validatedAt: VALIDATED },
      [id("b")]: { licenseKey: null },
      [id("c")]: { licenseKey: "key-c" },
    });
    await repository.saveLicense({
      organizationId: id("b"),
      license: { licenseKey: "own-b", expiresAt: EXPIRES, validatedAt: null },
    });

    const first = await repository.findLicensePairs({
      afterOrganizationId: backend.prefix(),
      limit: 2,
    });
    const second = await repository.findLicensePairs({
      afterOrganizationId: id("b"),
      limit: 5,
    });

    expect(first.map(viewPair)).toEqual([
      {
        organizationId: id("a"),
        columns: {
          licenseKey: "key-a",
          expiresAt: EXPIRES.toString(),
          validatedAt: VALIDATED.toString(),
        },
        own: null,
      },
      {
        organizationId: id("b"),
        columns: { licenseKey: null, expiresAt: null, validatedAt: null },
        own: { licenseKey: "own-b", expiresAt: EXPIRES.toString(), validatedAt: null },
      },
    ]);
    expect(second.filter(({ organizationId }) => mine(organizationId)).map(viewPair)).toEqual([
      {
        organizationId: id("c"),
        columns: { licenseKey: "key-c", expiresAt: null, validatedAt: null },
        own: null,
      },
    ]);
  });

  it("copies the missing rows and overwrites the ones that differ, with their dates", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: "key-a", expiresAt: EXPIRES, validatedAt: VALIDATED },
      [id("b")]: { licenseKey: "key-b", expiresAt: EXPIRES, validatedAt: null },
      [id("c")]: { licenseKey: "key-c", expiresAt: EXPIRES },
    });
    await repository.saveLicense({
      organizationId: id("b"),
      license: { licenseKey: "stale-b", expiresAt: EXPIRES, validatedAt: null },
    });
    await repository.saveLicense({
      organizationId: id("c"),
      license: { licenseKey: "key-c", expiresAt: EXPIRES, validatedAt: null },
    });
    const pairs = await repository.findLicensePairs({
      afterOrganizationId: backend.prefix(),
      limit: 3,
    });

    await expect(repository.overwriteLicenses({ pairs })).resolves.toBe(3);

    const after = await repository.findLicensePairs({
      afterOrganizationId: backend.prefix(),
      limit: 3,
    });
    expect(after.map(viewPair)).toEqual(
      pairs.map((pair) => viewPair({ ...pair, own: pair.columns })),
    );
  });

  it("keeps a row written after the pairs were read", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: "key-a" },
      [id("b")]: { licenseKey: "key-b" },
    });
    await repository.saveLicense({
      organizationId: id("b"),
      license: { licenseKey: "old-b", expiresAt: EXPIRES, validatedAt: null },
    });
    const pairs = await repository.findLicensePairs({
      afterOrganizationId: backend.prefix(),
      limit: 2,
    });
    await repository.saveLicense({
      organizationId: id("a"),
      license: { licenseKey: "newer-a", expiresAt: EXPIRES, validatedAt: null },
    });
    await repository.saveLicense({
      organizationId: id("b"),
      license: { licenseKey: "newer-b", expiresAt: EXPIRES, validatedAt: null },
    });

    await expect(repository.overwriteLicenses({ pairs })).resolves.toBe(0);

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({
      licenseKey: "newer-a",
    });
    await expect(repository.getOrganizationLicense(id("b"))).resolves.toEqual({
      licenseKey: "newer-b",
    });
  });

  it("keeps a licence written to both sides between the reads of the columns and the row", async () => {
    const repository = await backend.seed({ [id("a")]: { licenseKey: "key-a" } });
    const page = { afterOrganizationId: backend.prefix(), limit: 1 };
    const before = await repository.findLicensePairs(page);
    const newer = { licenseKey: "newer-a", expiresAt: EXPIRES, validatedAt: null };
    await repository.saveLicense({ organizationId: id("a"), license: newer });
    await backend.writeColumns({ organizationId: id("a"), columns: newer });
    const after = await repository.findLicensePairs(page);
    // Organization's columns as read before the write, licensing's row as read after it.
    const pairs = before.map((pair, index) => ({
      ...pair,
      own: after[index]?.own ?? null,
      ownUpdatedAt: after[index]?.ownUpdatedAt ?? null,
    }));
    expect(pairs.map(viewPair)).toEqual([
      {
        organizationId: id("a"),
        columns: { licenseKey: "key-a", expiresAt: null, validatedAt: null },
        own: { licenseKey: "newer-a", expiresAt: EXPIRES.toString(), validatedAt: null },
      },
    ]);

    await expect(repository.overwriteLicenses({ pairs })).resolves.toBe(0);

    await expect(repository.getOrganizationLicense(id("a"))).resolves.toEqual({
      licenseKey: "newer-a",
    });
  });

  it("leaves the rows as they were when the same pairs are written again", async () => {
    const repository = await backend.seed({
      [id("a")]: { licenseKey: "key-a", expiresAt: EXPIRES, validatedAt: VALIDATED },
    });
    const read = () =>
      repository.findLicensePairs({ afterOrganizationId: backend.prefix(), limit: 1 });
    await repository.overwriteLicenses({ pairs: await read() });

    await expect(repository.overwriteLicenses({ pairs: await read() })).resolves.toBe(1);

    const [pair] = await read();
    expect(view((pair as OrganizationLicensePair).own)).toEqual({
      licenseKey: "key-a",
      expiresAt: EXPIRES.toString(),
      validatedAt: VALIDATED.toString(),
    });
  });
}

describe("given the licence memory repository", () => {
  const prefix = `lic${randomUUID().replaceAll("-", "")}`;

  let organizations = new Map<string, Seed>();

  contractCases({
    prefix: () => prefix,
    seed: async (input) => {
      organizations = new Map(Object.entries(input));
      return MemoryOrganizationLicenseRepository.create(organizations);
    },
    writeColumns: async ({ organizationId, columns }) => {
      organizations.set(organizationId, columns);
    },
  });
});

const licenseData = (columns: Seed) => ({
  license: columns.licenseKey,
  licenseExpiresAt: columns.expiresAt ? toDate(columns.expiresAt) : null,
  licenseLastValidatedAt: columns.validatedAt ? toDate(columns.validatedAt) : null,
  ...(columns.updatedAt === undefined ? {} : { updatedAt: toDate(columns.updatedAt) }),
});

describe.skipIf(!TEST_DATABASE_URL)("given the licence Postgres repository", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;
  let prefix = "";

  const clean = async () => {
    if (prefix === "") return;
    await prisma.organizationLicense.deleteMany({
      where: { organizationId: { startsWith: prefix } },
    });
    await prisma.organization.deleteMany({ where: { id: { startsWith: prefix } } });
  };

  beforeEach(async () => {
    await clean();
    prefix = `lic${randomUUID().replaceAll("-", "")}`;
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  contractCases({
    prefix: () => prefix,
    seed: async (input) => {
      for (const [organizationId, columns] of Object.entries(input)) {
        await prisma.organization.create({
          data: {
            id: organizationId,
            name: `Licence ${organizationId}`,
            slug: organizationId,
            ...licenseData(columns),
          },
        });
      }
      return PrismaOrganizationLicenseRepository.create(prisma);
    },
    writeColumns: async ({ organizationId, columns }) => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: licenseData(columns),
      });
    },
  });
});
