/** The cross-tenant sweep write and its load-bearing clauses: name (off customer keys),
 * revokedAt: null (no rewrites), and expiresAt not null (keys without expiry). */
import type { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal, nowInstant, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaLangySessionKeyReapRepository } from "../prisma.langy-session-key-reap.repository.ts";
import { PrismaLangySessionKeyRepository } from "../prisma.langy-session-key.repository.ts";

function updateSpy(count = 0) {
  return vi.fn(async (_update: Prisma.ApiKeyUpdateManyArgs) => ({ count }));
}

function repositoryWith(updateMany: ReturnType<typeof updateSpy>) {
  return PrismaLangySessionKeyReapRepository.create(prismaDouble({ apiKey: { updateMany } }));
}

describe("PrismaLangySessionKeyReapRepository", () => {
  describe("given elapsed keys of one reserved name", () => {
    describe("when the sweep runs", () => {
      /** @scenario "The session-key sweep revokes only elapsed Langy session keys" */
      it("stamps the elapsed, unrevoked keys of that name as of the sweep's instant", async () => {
        const updateMany = updateSpy();
        const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

        await repositoryWith(updateMany).revokeExpiredByName({ name: "Langy session", now });

        expect(updateMany).toHaveBeenCalledWith({
          where: {
            name: "Langy session",
            revokedAt: null,
            expiresAt: { not: null, lte: toDate(now) },
          },
          data: { revokedAt: toDate(now) },
        });
      });

      /** @scenario "A session key with no expiry is never swept" */
      it("requires an expiry to exist before comparing it", async () => {
        const updateMany = updateSpy();

        await repositoryWith(updateMany).revokeExpiredByName({
          name: "Langy session",
          now: nowInstant(),
        });

        expect(updateMany.mock.calls[0]![0].where?.expiresAt).toMatchObject({ not: null });
      });

      /** @scenario "The session-key sweep leaves live and already-revoked keys alone" */
      it("never reconsiders a key it has already revoked", async () => {
        const updateMany = updateSpy();

        await repositoryWith(updateMany).revokeExpiredByName({
          name: "Langy session",
          now: nowInstant(),
        });

        expect(updateMany.mock.calls[0]![0].where?.revokedAt).toBeNull();
      });

      /** @scenario "The session-key sweep reports how many keys it retired" */
      it("answers the row count Postgres reported", async () => {
        const updateMany = updateSpy(3);

        await expect(
          repositoryWith(updateMany).revokeExpiredByName({
            name: "Langy session",
            now: nowInstant(),
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
        const database = prismaDouble({ apiKey: { updateMany } });

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
