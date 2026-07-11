import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaScheduledJobRepository } from "../scheduled-job.repository";

// Mirror the repository's naive-UTC timestamp rendering so we can assert the
// exact literals interpolated into the raw claim/settle.
const toPg = (d: Date): string => d.toISOString().slice(0, 23).replace("T", " ");

/**
 * Unit-level proof of the conditional lease + settle logic with a mocked Prisma.
 * Both MUST be single raw `$executeRaw` UPDATEs (prisma.updateMany drops the
 * `nextRunAt` guard when the where contains the @id, and a JS Date binds as
 * timestamptz so the equality never matches under a non-UTC session tz — see
 * the repository comments). We assert they route through `$executeRaw`,
 * interpolate the conditional guard values as naive-UTC `::timestamp` literals,
 * and map affected-rows → won/lost. (The real Postgres race is exercised
 * end-to-end in the integration suite.)
 */
describe("PrismaScheduledJobRepository.claim (lease)", () => {
  describe("given the row still carries the expected nextRunAt", () => {
    describe("when leasing the slot", () => {
      it("runs a raw conditional UPDATE that only moves nextRunAt to the lease and reports the lease won", async () => {
        const executeRaw = vi.fn().mockResolvedValue(1);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const expected = new Date("2026-07-13T09:00:00.000Z");
        const leaseUntil = new Date("2026-07-13T09:10:00.000Z");
        const won = await repo.claim({
          id: "job-1",
          projectId: "project-1",
          expectedNextRunAt: expected,
          leaseUntil,
        });

        expect(won).toBe(true);
        // Tagged-template call: (stringsArray, ...interpolatedValues). The
        // guard + the lease value must be present; the slot is NOT advanced to
        // a next cron instant and lastSlot is not stamped here (that is
        // settleClaim's job, post-delivery).
        const args = executeRaw.mock.calls[0];
        expect(args).toContain("job-1");
        expect(args).toContain("project-1");
        expect(args).toContain(toPg(expected)); // the `nextRunAt = expected` guard
        expect(args).toContain(toPg(leaseUntil)); // the lease
      });
    });
  });

  describe("given another worker already advanced the row", () => {
    describe("when leasing the slot", () => {
      it("reports the lease lost (zero rows matched the guard)", async () => {
        const executeRaw = vi.fn().mockResolvedValue(0);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const won = await repo.claim({
          id: "job-1",
          projectId: "project-1",
          expectedNextRunAt: new Date("2026-07-13T09:00:00.000Z"),
          leaseUntil: new Date("2026-07-13T09:10:00.000Z"),
        });

        expect(won).toBe(false);
      });
    });
  });
});

describe("PrismaScheduledJobRepository.settleClaim", () => {
  describe("given a delivered fire keyed on the held lease", () => {
    describe("when settling the claim", () => {
      it("runs a raw conditional UPDATE carrying the lease guard, the advance, the delivered slot and cleared retry state", async () => {
        const executeRaw = vi.fn().mockResolvedValue(1);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const leaseUntil = new Date("2026-07-13T09:10:00.000Z");
        const nextRunAt = new Date("2026-07-20T09:00:00.000Z");
        const slot = new Date("2026-07-13T09:00:00.000Z");
        const settled = await repo.settleClaim({
          id: "job-1",
          projectId: "project-1",
          expectedLease: leaseUntil,
          nextRunAt,
          lastSlot: slot,
          attempts: 0,
          lastError: null,
        });

        expect(settled).toBe(true);
        const args = executeRaw.mock.calls[0];
        expect(args).toContain("job-1");
        expect(args).toContain("project-1");
        expect(args).toContain(toPg(leaseUntil)); // the lease guard
        expect(args).toContain(toPg(nextRunAt)); // the advance
        expect(args).toContain(toPg(slot)); // the delivered lastSlot
        expect(args).toContain(0); // attempts reset
        expect(args).toContain(null); // lastError cleared
      });
    });
  });

  describe("given a retry that keeps lastSlot unchanged", () => {
    describe("when settling with a null lastSlot", () => {
      it("binds a null lastSlot (NULL::timestamp) rather than a timestamp literal", async () => {
        const executeRaw = vi.fn().mockResolvedValue(1);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const leaseUntil = new Date("2026-07-13T09:10:00.000Z");
        const retryAt = new Date("2026-07-13T09:01:00.000Z");
        const settled = await repo.settleClaim({
          id: "job-1",
          projectId: "project-1",
          expectedLease: leaseUntil,
          nextRunAt: retryAt,
          lastSlot: null, // never delivered — stays null
          attempts: 1,
          lastError: "boom",
        });

        expect(settled).toBe(true);
        const args = executeRaw.mock.calls[0];
        expect(args).toContain(toPg(leaseUntil));
        expect(args).toContain(toPg(retryAt));
        expect(args).toContain(1); // attempts bumped
        expect(args).toContain("boom"); // lastError recorded
        // lastSlot bound as null (SQL NULL), not a timestamp literal.
        expect(args).toContain(null);
      });
    });
  });

  describe("given the lease expired and was re-claimed", () => {
    describe("when settling the claim", () => {
      it("reports the settle lost (zero rows matched the lease guard)", async () => {
        const executeRaw = vi.fn().mockResolvedValue(0);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const settled = await repo.settleClaim({
          id: "job-1",
          projectId: "project-1",
          expectedLease: new Date("2026-07-13T09:10:00.000Z"),
          nextRunAt: new Date("2026-07-20T09:00:00.000Z"),
          lastSlot: new Date("2026-07-13T09:00:00.000Z"),
          attempts: 0,
          lastError: null,
        });

        expect(settled).toBe(false);
      });
    });
  });
});
