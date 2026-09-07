/**
 * The one-time reveal store on both of its stores: a fake Redis that answers
 * the four commands it uses, and the in-process map an instance without Redis
 * falls back to. The cipher is the encryption module's own concern; here it is
 * a marker, so the test can see that what reaches the store is not the secret.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { HandledError } from "@langwatch/handled-error";
import type { RedisConnection } from "@langwatch/redis-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/app-layer/app", () => ({ tryGetApp: () => null }));
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `sealed:${Buffer.from(text).toString("base64")}`,
  decrypt: (text: string) =>
    Buffer.from(text.replace(/^sealed:/, ""), "base64").toString(),
}));

import {
  ONE_TIME_REVEAL_TTL_MS,
  OneTimeRevealService,
  resetOneTimeRevealMemoryStore,
} from "../oneTimeReveal.service";

const SECRET = "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW";
const ORG = "org-one";

/** Just the commands the store uses, over a map with expiries. */
function fakeRedis(clock: { now: number }) {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const row = rows.get(key);
    if (!row) return null;
    if (row.expiresAt <= clock.now) {
      rows.delete(key);
      return null;
    }
    return row;
  };
  const redis = {
    set: vi.fn(async (key: string, value: string, _px: string, ttl: number) => {
      rows.set(key, { value, expiresAt: clock.now + ttl });
      return "OK";
    }),
    getdel: vi.fn(async (key: string) => {
      const row = live(key);
      rows.delete(key);
      return row?.value ?? null;
    }),
    get: vi.fn(async (key: string) => live(key)?.value ?? null),
    del: vi.fn(async (key: string) => (rows.delete(key) ? 1 : 0)),
    exists: vi.fn(async (key: string) => (live(key) ? 1 : 0)),
  };
  return { redis: redis as unknown as RedisConnection, rows, commands: redis };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HandledError) return error.code;
    throw error;
  }
  throw new Error("expected a handled error");
}

describe("OneTimeRevealService", () => {
  const clock = { now: 1_700_000_000_000 };

  beforeEach(() => {
    clock.now = 1_700_000_000_000;
    resetOneTimeRevealMemoryStore();
  });
  afterEach(() => {
    resetOneTimeRevealMemoryStore();
  });

  for (const store of ["redis", "memory"] as const) {
    describe(`given the ${store} store`, () => {
      const make = () => {
        const fake = fakeRedis(clock);
        const service = new OneTimeRevealService(
          store === "redis" ? fake.redis : null,
          () => clock.now,
        );
        return { service, fake };
      };

      describe("when a stashed reveal is read", () => {
        /** @scenario "The first reveal returns the secret and the second refuses" */
        /** @scenario "The reveal survives without Redis" */
        it("serves the secret once and refuses the second read as already revealed", async () => {
          const { service } = make();
          const { revealId } = await service.stash({
            organizationId: ORG,
            kind: "virtual_key",
            keyId: "vk_1",
            preview: "vk-lw-01HZX9N",
            secret: SECRET,
          });
          expect(revealId).toMatch(/^rvl_/);

          const first = await service.reveal({ organizationId: ORG, revealId });
          expect(first).toEqual({
            kind: "virtual_key",
            keyId: "vk_1",
            preview: "vk-lw-01HZX9N",
            secret: SECRET,
          });
          expect(
            await codeOf(service.reveal({ organizationId: ORG, revealId })),
          ).toBe("secret_already_revealed");
        });
      });

      describe("when the reveal id was never stashed", () => {
        it("refuses the read as expired", async () => {
          const { service } = make();
          expect(
            await codeOf(
              service.reveal({ organizationId: ORG, revealId: "rvl_nothing" }),
            ),
          ).toBe("secret_reveal_expired");
        });
      });

      describe("when another organization reads the id", () => {
        /** @scenario "A reveal belongs to the organization that minted it" */
        it("refuses it as expired and keeps the secret for the organization that minted it", async () => {
          const { service } = make();
          const { revealId } = await service.stash({
            organizationId: ORG,
            kind: "virtual_key",
            keyId: "vk_1",
            preview: "vk-lw-01HZX9N",
            secret: SECRET,
          });
          expect(
            await codeOf(
              service.reveal({ organizationId: "org-other", revealId }),
            ),
          ).toBe("secret_reveal_expired");
          const own = await service.reveal({ organizationId: ORG, revealId });
          expect(own.secret).toBe(SECRET);
        });
      });

      describe("when the day has passed", () => {
        it("refuses the read as expired, and a marker that old is gone too", async () => {
          const { service } = make();
          const { revealId } = await service.stash({
            organizationId: ORG,
            kind: "virtual_key",
            keyId: "vk_1",
            preview: "vk-lw-01HZX9N",
            secret: SECRET,
          });
          clock.now += ONE_TIME_REVEAL_TTL_MS + 1;
          expect(
            await codeOf(service.reveal({ organizationId: ORG, revealId })),
          ).toBe("secret_reveal_expired");
        });
      });
    });
  }

  describe("given the redis store", () => {
    describe("when the secret is stashed", () => {
      it("stores it sealed, under a day's expiry, and never in the clear", async () => {
        const fake = fakeRedis(clock);
        const service = new OneTimeRevealService(fake.redis, () => clock.now);
        await service.stash({
          organizationId: ORG,
          kind: "virtual_key",
          keyId: "vk_1",
          preview: "vk-lw-01HZX9N",
          secret: SECRET,
        });
        const [key, value, unit, ttl] = fake.commands.set.mock.calls[0]!;
        expect(key).toMatch(/^secret_reveal:org-one:rvl_/);
        expect(value).not.toContain(SECRET);
        expect(value).toContain("sealed:");
        expect(unit).toBe("PX");
        expect(ttl).toBe(ONE_TIME_REVEAL_TTL_MS);
      });
    });

    describe("when the server has no GETDEL", () => {
      it("reads and deletes in two steps and still serves once", async () => {
        const fake = fakeRedis(clock);
        fake.commands.getdel.mockRejectedValue(
          new Error("ERR unknown command 'getdel'"),
        );
        const service = new OneTimeRevealService(fake.redis, () => clock.now);
        const { revealId } = await service.stash({
          organizationId: ORG,
          kind: "virtual_key",
          keyId: "vk_1",
          preview: "vk-lw-01HZX9N",
          secret: SECRET,
        });
        const first = await service.reveal({ organizationId: ORG, revealId });
        expect(first.secret).toBe(SECRET);
        expect(fake.commands.del).toHaveBeenCalledTimes(1);
        expect(
          await codeOf(service.reveal({ organizationId: ORG, revealId })),
        ).toBe("secret_already_revealed");
      });
    });
  });
});
