import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake Redis: just enough INCR + EXPIRE to drive the middleware.
// Each test gets a fresh instance via beforeEach so buckets don't leak.
type FakeRedis = {
  store: Map<string, number>;
  expires: Map<string, number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, number>();
  const expires = new Map<string, number>();
  return {
    store,
    expires,
    incr: async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    expire: async (key: string, seconds: number) => {
      expires.set(key, seconds);
      return 1;
    },
  };
}

let fakeRedis: FakeRedis | null = null;

vi.mock("../../redis", () => ({
  get connection() {
    return fakeRedis;
  },
}));

const { checkLangyMessageRateLimit, LANGY_MESSAGES_PER_MINUTE } = await import(
  "../rate-limit-langy"
);

beforeEach(() => {
  fakeRedis = makeFakeRedis();
  vi.useFakeTimers();
  // Pin to a stable bucket boundary so retryAfter calculations are predictable.
  // Bucket = floor(now / 60_000); midpoint of bucket 0 = 30_000.
  vi.setSystemTime(new Date(30_000));
});

describe("checkLangyMessageRateLimit — binds langy-baseline.feature § Burst of messages is throttled per user per project", () => {
  describe("given a fresh per-minute bucket", () => {
    describe("when called once", () => {
      it("allows the request", async () => {
        const result = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
        });
        expect(result.allowed).toBe(true);
      });

      it("sets the bucket TTL on the first hit", async () => {
        await checkLangyMessageRateLimit({ userId: "u1", projectId: "p1" });
        const key = `langy:rl:msg:p1:u1:0`;
        expect(fakeRedis!.expires.get(key)).toBe(65);
      });

      it("namespaces the key by project and user", async () => {
        await checkLangyMessageRateLimit({ userId: "u1", projectId: "p1" });
        expect([...fakeRedis!.store.keys()]).toContain("langy:rl:msg:p1:u1:0");
      });
    });

    describe("when the same user hits exactly the limit", () => {
      it("still allows the final permitted request", async () => {
        let last: Awaited<ReturnType<typeof checkLangyMessageRateLimit>> | null =
          null;
        for (let i = 0; i < LANGY_MESSAGES_PER_MINUTE; i++) {
          last = await checkLangyMessageRateLimit({
            userId: "u1",
            projectId: "p1",
          });
        }
        expect(last?.allowed).toBe(true);
        expect(last?.remaining).toBe(0);
      });
    });

    describe("when the same user exceeds the limit", () => {
      beforeEach(async () => {
        for (let i = 0; i < LANGY_MESSAGES_PER_MINUTE + 1; i++) {
          await checkLangyMessageRateLimit({
            userId: "u1",
            projectId: "p1",
          });
        }
      });

      it("denies the over-limit request", async () => {
        const result = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
        });
        expect(result.allowed).toBe(false);
      });

      it("reports retryAfterSeconds counting down to the next bucket", async () => {
        const result = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
        });
        // At t=30_000, the next bucket starts at t=60_000, so retry-after = 30s.
        expect(result.retryAfterSeconds).toBe(30);
      });
    });

    describe("when two users in the same project hit the route", () => {
      it("does not share their buckets", async () => {
        for (let i = 0; i < LANGY_MESSAGES_PER_MINUTE + 1; i++) {
          await checkLangyMessageRateLimit({
            userId: "u1",
            projectId: "p1",
          });
        }
        const otherUser = await checkLangyMessageRateLimit({
          userId: "u2",
          projectId: "p1",
        });
        expect(otherUser.allowed).toBe(true);
      });
    });

    describe("when the same user is in a different project", () => {
      it("does not share their bucket across projects", async () => {
        for (let i = 0; i < LANGY_MESSAGES_PER_MINUTE + 1; i++) {
          await checkLangyMessageRateLimit({
            userId: "u1",
            projectId: "p1",
          });
        }
        const otherProject = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p2",
        });
        expect(otherProject.allowed).toBe(true);
      });
    });
  });

  describe("given Redis is unavailable", () => {
    beforeEach(() => {
      fakeRedis = null;
    });

    describe("when called", () => {
      it("no-ops and allows the request", async () => {
        const result = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
        });
        expect(result.allowed).toBe(true);
      });

      it("reports the configured limit as remaining", async () => {
        const result = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
          limit: 7,
        });
        expect(result.remaining).toBe(7);
      });
    });
  });

  describe("given a custom limit override", () => {
    describe("when limit=1 and one call has been made", () => {
      it("denies the second call", async () => {
        await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
          limit: 1,
        });
        const second = await checkLangyMessageRateLimit({
          userId: "u1",
          projectId: "p1",
          limit: 1,
        });
        expect(second.allowed).toBe(false);
      });
    });
  });
});
