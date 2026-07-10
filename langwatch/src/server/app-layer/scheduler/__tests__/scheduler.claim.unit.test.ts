import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaScheduledJobRepository } from "../scheduled-job.repository";

// Mirror the repository's naive-UTC timestamp rendering so we can assert the
// exact literals interpolated into the raw claim.
const toPg = (d: Date): string => d.toISOString().slice(0, 23).replace("T", " ");

/**
 * Unit-level proof of the conditional-claim logic with a mocked Prisma. The
 * claim MUST be a single raw `$executeRaw` UPDATE (prisma.updateMany drops the
 * `nextRunAt` guard when the where contains the @id, and a JS Date binds as
 * timestamptz so the equality never matches under a non-UTC session tz — see
 * the repository comments). We assert it routes through `$executeRaw`,
 * interpolates the conditional guard values as naive-UTC `::timestamp`
 * literals (id + projectId + expectedNextRunAt), and maps affected-rows →
 * won/lost. (The real Postgres race is exercised end-to-end in the
 * integration suite.)
 */
describe("PrismaScheduledJobRepository.claim", () => {
  describe("given the row still carries the expected nextRunAt", () => {
    describe("when claiming the slot", () => {
      it("runs a raw conditional UPDATE carrying the guard and reports the claim won", async () => {
        const executeRaw = vi.fn().mockResolvedValue(1);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const expected = new Date("2026-07-13T09:00:00.000Z");
        const advanced = new Date("2026-07-20T09:00:00.000Z");
        const won = await repo.claim({
          id: "job-1",
          projectId: "project-1",
          expectedNextRunAt: expected,
          nextRunAt: advanced,
          lastSlot: expected,
        });

        expect(won).toBe(true);
        // Tagged-template call: (stringsArray, ...interpolatedValues). The
        // conditional guard values must all be present.
        const args = executeRaw.mock.calls[0];
        expect(args).toContain("job-1");
        expect(args).toContain("project-1");
        expect(args).toContain(toPg(expected)); // the `nextRunAt = expected` guard
        expect(args).toContain(toPg(advanced)); // the advance
      });
    });
  });

  describe("given another worker already advanced the row", () => {
    describe("when claiming the slot", () => {
      it("reports the claim lost (zero rows matched the guard)", async () => {
        const executeRaw = vi.fn().mockResolvedValue(0);
        const prisma = {
          $executeRaw: executeRaw,
        } as unknown as PrismaClient;
        const repo = new PrismaScheduledJobRepository(prisma);

        const won = await repo.claim({
          id: "job-1",
          projectId: "project-1",
          expectedNextRunAt: new Date("2026-07-13T09:00:00.000Z"),
          nextRunAt: new Date("2026-07-20T09:00:00.000Z"),
          lastSlot: new Date("2026-07-13T09:00:00.000Z"),
        });

        expect(won).toBe(false);
      });
    });
  });
});
