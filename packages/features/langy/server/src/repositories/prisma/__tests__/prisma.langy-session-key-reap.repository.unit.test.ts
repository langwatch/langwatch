/**
 * The one write the sweep performs, and the clauses that bound it.
 *
 * It runs cross-tenant, so every clause is load-bearing: the name is what keeps
 * it off customer keys, `revokedAt: null` is what stops it rewriting rows it
 * already retired, and `expiresAt: { not: null }` is what keeps a key created
 * without an expiry out of a `lte` comparison. The last case pins the App's
 * wider repository to this same query — two copies of this predicate is how a
 * widened sweep gets shipped by only half the fleet.
 *
 * Spec: packages/features/langy/specs/langy-session-key-maintenance.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { LangyDatabase } from "../langy-database.port";
import {
  PrismaLangySessionKeyReapRepository,
  type PrismaLangySessionKeyReapDatabase,
} from "../prisma.langy-session-key-reap.repository";
import { PrismaLangySessionKeyRepository } from "../prisma.langy-session-key.repository";

type SweepUpdate = {
  where: { name: string; revokedAt: Date | null; expiresAt: { not: null; lte: Date } };
  data: { revokedAt: Date };
};

function updateSpy(count = 0) {
  return vi.fn(async (_update: SweepUpdate) => ({ count }));
}

function repositoryWith(updateMany: ReturnType<typeof updateSpy>) {
  return PrismaLangySessionKeyReapRepository.create({
    apiKey: { updateMany },
  } as unknown as PrismaLangySessionKeyReapDatabase);
}

describe("PrismaLangySessionKeyReapRepository", () => {
  describe("given elapsed keys of one reserved name", () => {
    describe("when the sweep runs", () => {
      /** @scenario "The session-key sweep revokes only elapsed Langy session keys" */
      it("stamps the elapsed, unrevoked keys of that name as of the sweep's instant", async () => {
        const updateMany = updateSpy();
        const now = new Date("2026-01-01T00:00:00.000Z");

        await repositoryWith(updateMany).revokeExpiredByName({ name: "Langy session", now });

        expect(updateMany).toHaveBeenCalledWith({
          where: {
            name: "Langy session",
            revokedAt: null,
            expiresAt: { not: null, lte: now },
          },
          data: { revokedAt: now },
        });
      });

      /** @scenario "A session key with no expiry is never swept" */
      it("requires an expiry to exist before comparing it", async () => {
        const updateMany = updateSpy();

        await repositoryWith(updateMany).revokeExpiredByName({
          name: "Langy session",
          now: new Date(),
        });

        expect(updateMany.mock.calls[0]![0].where.expiresAt).toMatchObject({ not: null });
      });

      /** @scenario "The session-key sweep leaves live and already-revoked keys alone" */
      it("never reconsiders a key it has already revoked", async () => {
        const updateMany = updateSpy();

        await repositoryWith(updateMany).revokeExpiredByName({
          name: "Langy session",
          now: new Date(),
        });

        expect(updateMany.mock.calls[0]![0].where.revokedAt).toBeNull();
      });

      /** @scenario "The session-key sweep reports how many keys it retired" */
      it("answers the row count Postgres reported", async () => {
        const updateMany = updateSpy(3);

        await expect(
          repositoryWith(updateMany).revokeExpiredByName({
            name: "Langy session",
            now: new Date(),
          }),
        ).resolves.toBe(3);
      });
    });
  });

  describe("given the App reaches the sweep through the wider repository", () => {
    describe("when it runs the reap", () => {
      /** @scenario "The session-key sweep keeps one set of routing keys across both graphs" */
      it("issues the identical predicate the narrow repository issues", async () => {
        const updateMany = updateSpy();
        const now = new Date("2026-02-02T00:00:00.000Z");
        const database = { apiKey: { updateMany } } as unknown as LangyDatabase;

        await PrismaLangySessionKeyRepository.create(database).reapExpired(now, "Langy session");

        expect(updateMany).toHaveBeenCalledWith({
          where: {
            name: "Langy session",
            revokedAt: null,
            expiresAt: { not: null, lte: now },
          },
          data: { revokedAt: now },
        });
      });
    });
  });
});
