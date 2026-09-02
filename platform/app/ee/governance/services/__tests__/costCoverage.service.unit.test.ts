// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the key-to-bill mapping refuses before it writes anything (ADR-128 §7).
 *
 * The rules the DATABASE holds are proved against real Postgres in
 * `governanceCostCoverage.integration.test.ts`; an application-level double
 * would pass while the constraint was absent. What is proved here is the half
 * the database cannot: the guards that run first, and that a refusal writes
 * nothing.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import type {
  CoveragePeriod,
  IngestionSourceKeyCoverageRepository,
} from "../../repositories/ingestionSourceKeyCoverage.repository";
import { CostCoverageService } from "../costCoverage.service";

const organizationId = "org_1";
const virtualKeyId = "vk_1";

const openPeriod = (validFrom: string): CoveragePeriod => ({
  id: "cov_1",
  ingestionSourceId: "bill_1",
  virtualKeyId,
  validFrom: new Date(validFrom),
  validTo: null,
});

/**
 * A repository whose transaction really runs the callback, so a guard that
 * throws inside it is observed exactly where it would be in production.
 */
const serviceWith = (open: CoveragePeriod | null) => {
  const repo = {
    findAllByOrganization: vi.fn(),
    findAllBySource: vi.fn(),
    findOpenForUpdate: vi.fn().mockResolvedValue(open),
    open: vi.fn(async (_client, params) => ({
      id: "cov_new",
      ingestionSourceId: params.ingestionSourceId,
      virtualKeyId: params.virtualKeyId,
      validFrom: params.validFrom,
      validTo: null,
    })),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IngestionSourceKeyCoverageRepository;
  const prisma = {
    $transaction: (run: (tx: unknown) => unknown) => run({}),
  } as unknown as PrismaClient;
  return { service: new CostCoverageService(prisma, repo), repo };
};

describe("Feature: a bill takes over a key on a date", () => {
  describe("when an administrator records coverage starting partway through a day", () => {
    /** @scenario "Coverage may only start at midnight" */
    it("refuses it and asks for a date", async () => {
      const { service, repo } = serviceWith(null);

      await expect(
        service.pointKeyAtSource({
          organizationId,
          virtualKeyId,
          ingestionSourceId: "bill_2",
          effectiveFrom: new Date("2026-06-01T09:30:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "ingestion_source_coverage_not_midnight",
      });
      expect(repo.open).not.toHaveBeenCalled();
    });
  });

  describe("given a bill that began covering a key today", () => {
    /** @scenario "Coverage cannot be moved to the day it already started" */
    it("refuses a move effective that same day and asks for a later one", async () => {
      const { service, repo } = serviceWith(
        openPeriod("2026-06-01T00:00:00.000Z"),
      );

      await expect(
        service.pointKeyAtSource({
          organizationId,
          virtualKeyId,
          ingestionSourceId: "bill_2",
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "ingestion_source_coverage_not_after_start",
      });
      // The refusal happens before either write: closing at the instant the
      // period began would leave a period covering no time at all.
      expect(repo.close).not.toHaveBeenCalled();
      expect(repo.open).not.toHaveBeenCalled();
    });
  });

  describe("when the key already points at that same bill", () => {
    it("leaves the existing coverage alone rather than putting a seam in it", async () => {
      const current = openPeriod("2026-01-01T00:00:00.000Z");
      const { service, repo } = serviceWith(current);

      const result = await service.pointKeyAtSource({
        organizationId,
        virtualKeyId,
        ingestionSourceId: "bill_1",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      });

      expect(result).toBe(current);
      expect(repo.close).not.toHaveBeenCalled();
      expect(repo.open).not.toHaveBeenCalled();
    });
  });

  describe("when no bill covers the key yet", () => {
    it("opens coverage without closing anything", async () => {
      const { service, repo } = serviceWith(null);

      const result = await service.pointKeyAtSource({
        organizationId,
        virtualKeyId,
        ingestionSourceId: "bill_2",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      });

      expect(result.ingestionSourceId).toBe("bill_2");
      expect(repo.close).not.toHaveBeenCalled();
    });
  });
});

describe("Feature: a bill stops covering a key", () => {
  describe("when nothing covers the key", () => {
    it("does nothing rather than failing", async () => {
      const { service, repo } = serviceWith(null);

      await service.stopCoveringKey({
        organizationId,
        virtualKeyId,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      });

      expect(repo.close).not.toHaveBeenCalled();
    });
  });

  describe("when the key is covered", () => {
    it("closes the period rather than deleting it, so past months keep their bill", async () => {
      const { service, repo } = serviceWith(
        openPeriod("2026-01-01T00:00:00.000Z"),
      );

      await service.stopCoveringKey({
        organizationId,
        virtualKeyId,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      });

      expect(repo.close).toHaveBeenCalledWith(expect.anything(), {
        organizationId,
        id: "cov_1",
        validTo: new Date("2026-06-01T00:00:00.000Z"),
      });
    });

    it("refuses a mid-day end", async () => {
      const { service, repo } = serviceWith(
        openPeriod("2026-01-01T00:00:00.000Z"),
      );

      await expect(
        service.stopCoveringKey({
          organizationId,
          virtualKeyId,
          effectiveFrom: new Date("2026-06-01T13:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "ingestion_source_coverage_not_midnight",
      });
      expect(repo.close).not.toHaveBeenCalled();
    });
  });
});
