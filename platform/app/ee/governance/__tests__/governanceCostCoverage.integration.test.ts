// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The key-to-bill mapping's rules, against real Postgres — because every one of
 * them is a database guarantee and nothing else. An application-level check
 * would pass this file while leaving the constraint absent, which is the
 * failure this exists to catch.
 *
 * Requires the triggers and the one-open-bill index the migration installs.
 * Plain Postgres - deliberately no extension is needed.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 * Decision: ADR-128 §7
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { IngestionSourceKeyCoverageRepository } from "../repositories/ingestionSourceKeyCoverage.repository";
import {
  CoverageStartNotAfterCurrentError,
  GatewayKeyAlreadyCoveredError,
} from "../services/costCoverage.errors";
import { CostCoverageService } from "../services/costCoverage.service";
import { isUniqueViolation } from "../services/logic/postgresConstraintErrors";

const ns = `gov-coverage-${nanoid(8)}`;
const organizationId = `org_${ns}`;
const otherOrganizationId = `org_other_${ns}`;

/**
 * How Prisma reports the one-open-bill index refusing a second open row.
 *
 * Like the foreign-key case below, Prisma has a mapping of its own for a
 * unique violation and replaces the raw 23505 entirely, so the Prisma code is
 * the thing there is to assert on.
 */
const PRISMA_UNIQUE_VIOLATION = "P2002";
/** Postgres' own unique-violation code, seen when a write bypasses Prisma. */
const UNIQUE_VIOLATION = "23505";
/** Postgres' check-constraint violation. */
const CHECK_VIOLATION = "23514";
/**
 * How Prisma reports what the organization-mismatch trigger raises.
 *
 * The trigger raises SQLSTATE 23503, and this is the one case where asserting
 * on a Prisma code rather than the driver's is right: Prisma has a specific
 * mapping for it (`P2003`, foreign key constraint violated) and replaces the
 * raw code entirely, so the SQLSTATE is not in the error at all to be read.
 */
const PRISMA_FOREIGN_KEY_VIOLATION = "P2003";

/**
 * The Postgres SQLSTATE behind a Prisma failure.
 *
 * Prisma reports a constraint it has no code of its own for as `P2039` and puts
 * the driver's error underneath, so reading `error.code` alone would assert on
 * Prisma's "something happened" wrapper and pass whether the constraint exists
 * or not. This walks the cause chain to the code the database actually raised.
 */
const sqlState = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const code = record.code;
    if (
      typeof code === "string" &&
      /^[0-9A-Z]{5}$/.test(code) &&
      code[0] !== "P"
    ) {
      return code;
    }
    const meta = record.meta;
    if (meta && typeof meta === "object") {
      const metaCode = (meta as Record<string, unknown>).code;
      if (typeof metaCode === "string" && metaCode[0] !== "P") return metaCode;
    }
    current =
      record.cause ?? (meta as Record<string, unknown> | undefined)?.cause;
  }
  const message = String((error as { message?: string })?.message ?? "");
  return /\b(23505|23514|23503)\b/.exec(message)?.[1];
};

const makeKey = async (params: { id: string; organizationId: string }) => {
  await prisma.virtualKey.create({
    data: {
      id: params.id,
      organizationId: params.organizationId,
      name: `--test-${params.id}`,
      hashedSecret: `hash_${params.id}`,
      displayPrefix: `vk-test-${params.id.slice(-6)}`,
      createdById: `user_${ns}`,
    },
  });
};

/**
 * A connected bill for the coverage rows to name.
 *
 * Real rows rather than fabricated ids, because the row-to-source trigger reads
 * them: the mapping's two ends are both checked against the row's own
 * organization, and a made-up bill id is refused exactly as a made-up key is.
 */
const makeSource = async (params: { id: string; organizationId: string }) => {
  await prisma.ingestionSource.create({
    data: {
      id: params.id,
      organizationId: params.organizationId,
      sourceType: "otel_generic",
      name: `--test-${params.id}`,
      ingestSecretHash: `hash_${params.id}`,
    },
  });
};

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

const repo = new IngestionSourceKeyCoverageRepository();
const service = new CostCoverageService(prisma, repo);

describe("Feature: every dollar has one home", () => {
  const ownKeyId = `vk_${ns}_own`;
  const foreignKeyId = `vk_${ns}_foreign`;

  const foreignSourceId = `bill_other_${ns}`;

  beforeAll(async () => {
    await makeKey({ id: ownKeyId, organizationId });
    await makeKey({ id: foreignKeyId, organizationId: otherOrganizationId });
    await makeSource({ id: `bill_1_${ns}`, organizationId });
    await makeSource({ id: `bill_2_${ns}`, organizationId });
    await makeSource({
      id: foreignSourceId,
      organizationId: otherOrganizationId,
    });
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["ingestionSourceKeyCoverage", { organizationId }],
      ["ingestionSourceKeyCoverage", { organizationId: otherOrganizationId }],
      ["virtualKey", { organizationId }],
      ["virtualKey", { organizationId: otherOrganizationId }],
      ["ingestionSource", { organizationId }],
      ["ingestionSource", { organizationId: otherOrganizationId }],
    ]),
  );

  describe("given a bill covering a gateway key from the first of the month", () => {
    const keyId = `${ownKeyId}`;

    /** @scenario "A second bill cannot claim a key another bill already covers" */
    it("refuses a second bill claiming the same key over the same period", async () => {
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: keyId,
        validFrom: utc("2026-03-01"),
      });

      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: `bill_2_${ns}`,
          virtualKeyId: keyId,
          validFrom: utc("2026-03-01"),
        })
        .catch((error: unknown) => error);

      // Prisma wraps the 23505 as P2002 and keeps the SQLSTATE to itself, so
      // the second assertion is the application's own predicate — the exact
      // contract the service's catch site relies on.
      expect((refused as { code?: string }).code).toBe(PRISMA_UNIQUE_VIOLATION);
      expect(isUniqueViolation(refused)).toBe(true);
    });

    /** @scenario "A bill may cover a key another bill has finished covering" */
    it("accepts a bill taking over where the previous one ended", async () => {
      const takeoverKey = `vk_${ns}_takeover`;
      await makeKey({ id: takeoverKey, organizationId });

      const first = await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: takeoverKey,
        validFrom: utc("2026-01-01"),
      });
      await repo.close(prisma, {
        organizationId,
        id: first.id,
        validTo: utc("2026-06-01"),
      });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_2_${ns}`,
        virtualKeyId: takeoverKey,
        validFrom: utc("2026-06-01"),
      });

      const may = await service.getCoverageOnDay({
        organizationId,
        day: "2026-05-31",
      });
      const june = await service.getCoverageOnDay({
        organizationId,
        day: "2026-06-01",
      });

      expect(may.get(takeoverKey)).toBe(`bill_1_${ns}`);
      expect(june.get(takeoverKey)).toBe(`bill_2_${ns}`);
    });
  });

  describe("when a second open bill is written straight to the database", () => {
    it("is refused by the database itself, not by application code", async () => {
      const rawKey = `vk_${ns}_raw`;
      await makeKey({ id: rawKey, organizationId });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: rawKey,
        validFrom: utc("2026-03-01"),
      });

      let caught: unknown;
      try {
        // Raw SQL on purpose: this proves the rule holds for a writer that
        // skips Prisma and the service layer entirely.
        await prisma.$executeRawUnsafe(
          `
          -- @tenancy: single fixed test row; the rule under test is per-key,
          -- not per-tenant.
          INSERT INTO "IngestionSourceKeyCoverage"
            ("id", "organizationId", "ingestionSourceId", "virtualKeyId", "validFrom", "validTo")
          VALUES ($1, $2, $3, $4, '2026-04-01T00:00:00Z', NULL)
          `,
          `cov_raw_${ns}`,
          organizationId,
          `bill_2_${ns}`,
          rawKey,
        );
      } catch (error) {
        caught = error;
      }

      expect(sqlState(caught)).toBe(UNIQUE_VIOLATION);

      // And the invariant itself: no key holds two open bills.
      const doubled = await prisma.$queryRawUnsafe<unknown[]>(`
        -- @tenancy: invariant sweep across the whole test database; a second
        -- open bill anywhere is a failure regardless of tenant.
        SELECT "virtualKeyId", count(*)
        FROM "IngestionSourceKeyCoverage"
        WHERE "validTo" IS NULL
        GROUP BY 1
        HAVING count(*) > 1
      `);
      expect(doubled).toHaveLength(0);
    });
  });

  describe("when a closed period overlapping an open one is written", () => {
    it("is accepted: the rule only counts open bills", async () => {
      // Boundary made explicit: this is the guarantee traded away with the
      // gist exclusion constraint. Closed history stays non-overlapping only
      // because every closed row is written by the service transaction that
      // holds the open row FOR UPDATE — a writer bypassing the service, like
      // this one, is not refused. The trade and its reasoning live in the
      // migration's header comment.
      const tradedKey = `vk_${ns}_traded`;
      await makeKey({ id: tradedKey, organizationId });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: tradedKey,
        validFrom: utc("2026-01-01"),
      });

      await prisma.ingestionSourceKeyCoverage.create({
        data: {
          id: `cov_traded_${ns}`,
          organizationId,
          ingestionSourceId: `bill_2_${ns}`,
          virtualKeyId: tradedKey,
          validFrom: utc("2025-12-01"),
          validTo: utc("2026-02-01"),
        },
      });

      const rows = await repo.findAllByOrganization(prisma, { organizationId });
      expect(rows.map((row) => row.id)).toContain(`cov_traded_${ns}`);
    });
  });

  describe("when coverage describes no time at all", () => {
    /** @scenario "Coverage that starts and ends at the same moment is refused" */
    it("refuses a period that ends the instant it begins", async () => {
      const zeroWidthKey = `vk_${ns}_zero`;
      await makeKey({ id: zeroWidthKey, organizationId });

      const refused = await prisma.ingestionSourceKeyCoverage
        .create({
          data: {
            organizationId,
            ingestionSourceId: `bill_1_${ns}`,
            virtualKeyId: zeroWidthKey,
            validFrom: utc("2026-03-01"),
            validTo: utc("2026-03-01"),
          },
        })
        .catch((error: unknown) => error);

      // A zero-width period is closed the instant it begins, so the
      // one-open-bill index never sees it — the CHECK is the only thing that
      // does.
      expect(sqlState(refused)).toBe(CHECK_VIOLATION);
    });

    /** @scenario "Coverage that ends before it begins is refused" */
    it("refuses a period that ends before it begins", async () => {
      const invertedKey = `vk_${ns}_inverted`;
      await makeKey({ id: invertedKey, organizationId });

      const refused = await prisma.ingestionSourceKeyCoverage
        .create({
          data: {
            organizationId,
            ingestionSourceId: `bill_1_${ns}`,
            virtualKeyId: invertedKey,
            validFrom: utc("2026-06-01"),
            validTo: utc("2026-03-01"),
          },
        })
        .catch((error: unknown) => error);

      expect(sqlState(refused)).toBe(CHECK_VIOLATION);
    });
  });

  describe("given a gateway key belonging to one organization", () => {
    /** @scenario "Coverage cannot name a different organization than its key" */
    it("refuses coverage recorded under another organization", async () => {
      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: `bill_1_${ns}`,
          virtualKeyId: foreignKeyId,
          validFrom: utc("2026-03-01"),
        })
        .catch((error: unknown) => error);

      expect((refused as { code?: string }).code).toBe(
        PRISMA_FOREIGN_KEY_VIOLATION,
      );
    });

    it("refuses coverage of a key that does not exist", async () => {
      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: `bill_1_${ns}`,
          virtualKeyId: `vk_${ns}_missing`,
          validFrom: utc("2026-03-01"),
        })
        .catch((error: unknown) => error);

      expect((refused as { code?: string }).code).toBe(
        PRISMA_FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe("given a connected bill belonging to another organization", () => {
    // The mirror of the key check, and the reason it exists: without it one
    // organization's key can be recorded as paid for by another organization's
    // bill, which is the same misattribution reached from the other end.
    it("refuses coverage naming that bill", async () => {
      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: foreignSourceId,
          virtualKeyId: ownKeyId,
          validFrom: utc("2026-03-01"),
        })
        .catch((error: unknown) => error);

      expect((refused as { code?: string }).code).toBe(
        PRISMA_FOREIGN_KEY_VIOLATION,
      );
    });

    it("refuses coverage naming a bill that does not exist", async () => {
      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: `bill_missing_${ns}`,
          virtualKeyId: ownKeyId,
          validFrom: utc("2026-03-01"),
        })
        .catch((error: unknown) => error);

      expect((refused as { code?: string }).code).toBe(
        PRISMA_FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe("given a bill covering a gateway key", () => {
    /** @scenario "Moving a key to another bill closes the old coverage and opens the new together" */
    it("closes the old coverage and opens the new one at the same instant", async () => {
      const movedKey = `vk_${ns}_moved`;
      await makeKey({ id: movedKey, organizationId });
      await service.pointKeyAtSource({
        organizationId,
        virtualKeyId: movedKey,
        ingestionSourceId: `bill_1_${ns}`,
        effectiveFrom: utc("2026-01-01"),
      });

      await service.pointKeyAtSource({
        organizationId,
        virtualKeyId: movedKey,
        ingestionSourceId: `bill_2_${ns}`,
        effectiveFrom: utc("2026-06-01"),
      });

      const periods = (
        await repo.findAllByOrganization(prisma, { organizationId })
      ).filter((row) => row.virtualKeyId === movedKey);
      expect(periods).toHaveLength(2);
      expect(periods[0]?.validTo).toEqual(utc("2026-06-01"));
      expect(periods[1]?.validFrom).toEqual(utc("2026-06-01"));

      // No day between the two belongs to nobody, and none belongs to both.
      for (const day of ["2026-05-31", "2026-06-01"]) {
        const covering = await service.getCoverageOnDay({
          organizationId,
          day,
        });
        expect(covering.has(movedKey)).toBe(true);
      }
    });

    /** @scenario "A failed move leaves the original coverage intact" */
    it("leaves the original coverage intact when the move fails partway", async () => {
      const stuckKey = `vk_${ns}_stuck`;
      await makeKey({ id: stuckKey, organizationId });
      await service.pointKeyAtSource({
        organizationId,
        virtualKeyId: stuckKey,
        ingestionSourceId: `bill_1_${ns}`,
        effectiveFrom: utc("2026-01-01"),
      });

      // The successor's write fails AFTER the predecessor has already been
      // closed inside the same transaction. If the two writes were independent,
      // this is exactly the interleave that would leave the key covered by no
      // bill from June onward, with nothing raised and nothing to find it
      // later. Real Postgres, so what is proved is the rollback, not a double.
      const failsToOpen = Object.create(
        repo,
      ) as IngestionSourceKeyCoverageRepository;
      failsToOpen.open = () => Promise.reject(new Error("write lost"));
      const refused = await new CostCoverageService(prisma, failsToOpen)
        .pointKeyAtSource({
          organizationId,
          virtualKeyId: stuckKey,
          ingestionSourceId: `bill_2_${ns}`,
          effectiveFrom: utc("2026-06-01"),
        })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(Error);

      const periods = (
        await repo.findAllByOrganization(prisma, { organizationId })
      ).filter((row) => row.virtualKeyId === stuckKey);
      expect(periods).toHaveLength(1);
      expect(periods[0]?.validTo).toBeNull();
      expect(periods[0]?.ingestionSourceId).toBe(`bill_1_${ns}`);
    });
  });

  describe("when a gateway key is deleted", () => {
    it("takes its coverage with it, so the key's slot is not held forever", async () => {
      const doomedKey = `vk_${ns}_doomed`;
      await makeKey({ id: doomedKey, organizationId });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: doomedKey,
        validFrom: utc("2026-01-01"),
      });

      await prisma.virtualKey.deleteMany({
        where: { organizationId, id: doomedKey },
      });

      const left = (
        await repo.findAllByOrganization(prisma, { organizationId })
      ).filter((row) => row.virtualKeyId === doomedKey);
      expect(left).toHaveLength(0);
    });
  });

  describe("when two administrators claim the same key at once", () => {
    it("tells the loser another bill already covers it", async () => {
      const racedKey = `vk_${ns}_raced`;
      await makeKey({ id: racedKey, organizationId });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: racedKey,
        validFrom: utc("2026-01-01"),
      });

      // The service's own read would find the open row and close it, so the
      // index is reached by a writer that never saw it — which is what a
      // racing second administrator is.
      const refused = await repo
        .open(prisma, {
          organizationId,
          ingestionSourceId: `bill_2_${ns}`,
          virtualKeyId: racedKey,
          validFrom: utc("2026-02-01"),
        })
        .catch((error: unknown) => error);

      expect((refused as { code?: string }).code).toBe(PRISMA_UNIQUE_VIOLATION);
      expect(isUniqueViolation(refused)).toBe(true);
    });

    /**
     * The two tests below are the only ones that reach the service's translation
     * of a database refusal into words. Everything else here drives the
     * repository, where the assertion is a SQLSTATE — which proves the
     * constraint holds but proves nothing about what the losing administrator is
     * shown. Without these, that translation could be deleted whole and every
     * other test would still pass.
     *
     * Both simulate exactly one thing: what the losing transaction READ. The
     * stale read is what makes a race a race, and it is not reproducible on
     * demand from two real connections. The write it then makes, the constraint
     * that refuses it and the error that comes back are all real.
     */
    /** @scenario "A second bill cannot claim a key another bill already covers" */
    it("tells the losing administrator, in words, that another bill covers it", async () => {
      const contestedKey = `vk_${ns}_contested`;
      await makeKey({ id: contestedKey, organizationId });
      await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: contestedKey,
        validFrom: utc("2026-01-01"),
      });

      // The loser's transaction read the key before the winner committed, so it
      // finds no open row to close and goes straight to opening its own.
      const readsNothing = Object.create(
        repo,
      ) as IngestionSourceKeyCoverageRepository;
      readsNothing.findOpenForUpdate = () => Promise.resolve(null);

      const refused = await new CostCoverageService(prisma, readsNothing)
        .pointKeyAtSource({
          organizationId,
          virtualKeyId: contestedKey,
          ingestionSourceId: `bill_2_${ns}`,
          effectiveFrom: utc("2026-02-01"),
        })
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(GatewayKeyAlreadyCoveredError);
      expect((refused as GatewayKeyAlreadyCoveredError).code).toBe(
        "ingestion_source_key_already_covered",
      );
      expect((refused as GatewayKeyAlreadyCoveredError).meta).toMatchObject({
        virtualKeyId: contestedKey,
      });

      // The winner's coverage is untouched, and no second row was left behind.
      const periods = (
        await repo.findAllByOrganization(prisma, { organizationId })
      ).filter((row) => row.virtualKeyId === contestedKey);
      expect(periods).toHaveLength(1);
      expect(periods[0]?.ingestionSourceId).toBe(`bill_1_${ns}`);
    });

    it("tells the losing administrator when the coverage it is closing already starts then", async () => {
      const seamKey = `vk_${ns}_seam`;
      await makeKey({ id: seamKey, organizationId });
      const current = await repo.open(prisma, {
        organizationId,
        ingestionSourceId: `bill_1_${ns}`,
        virtualKeyId: seamKey,
        validFrom: utc("2026-06-01"),
      });

      // Here the winner moved the key to a period beginning at the very instant
      // this transaction is moving it from. The stale read is of the row as it
      // was BEFORE that, so the service's own "after the current start" check
      // passes; the close it then makes leaves a period covering no time, and
      // the CHECK is the only thing that sees it.
      const readsStale = Object.create(
        repo,
      ) as IngestionSourceKeyCoverageRepository;
      readsStale.findOpenForUpdate = () =>
        Promise.resolve({ ...current, validFrom: utc("2026-01-01") });

      const refused = await new CostCoverageService(prisma, readsStale)
        .pointKeyAtSource({
          organizationId,
          virtualKeyId: seamKey,
          ingestionSourceId: `bill_2_${ns}`,
          effectiveFrom: utc("2026-06-01"),
        })
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(CoverageStartNotAfterCurrentError);
      expect((refused as CoverageStartNotAfterCurrentError).code).toBe(
        "ingestion_source_coverage_not_after_start",
      );

      const periods = (
        await repo.findAllByOrganization(prisma, { organizationId })
      ).filter((row) => row.virtualKeyId === seamKey);
      expect(periods).toHaveLength(1);
      expect(periods[0]?.validTo).toBeNull();
    });
  });
});
