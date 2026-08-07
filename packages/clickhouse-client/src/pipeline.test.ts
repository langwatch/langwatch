import { describe, expect, it, vi } from "vitest";
import { compose, type QueryExecutor, type QueryMiddleware } from "./pipeline";
import { createConcurrencyLimiter, rateLimit } from "./rateLimit";
import { retry } from "./retry";

const driver: QueryExecutor = async () => ({ rows: [] });

const marking =
  (order: string[], name: string): QueryMiddleware =>
  (next) =>
  async (request) => {
    order.push(`${name}:before`);
    const result = await next(request);
    order.push(`${name}:after`);
    return result;
  };

const request = { tenantId: "project_1", sql: "SELECT 1" };

describe("compose", () => {
  describe("given several middleware", () => {
    it("applies them left to right, so the first entry is outermost", () => {
      const order: string[] = [];

      void compose([marking(order, "a"), marking(order, "b")])(driver)(request);

      expect(order).toEqual(["a:before", "b:before"]);
    });

    it("unwinds in reverse", async () => {
      const order: string[] = [];

      await compose([marking(order, "a"), marking(order, "b")])(driver)(
        request,
      );

      expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
    });
  });

  describe("given no middleware", () => {
    it("composes to the identity so an empty pipeline needs no special case", async () => {
      const executor = vi.fn(driver);

      await compose([])(executor)(request);

      expect(executor).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the limiter and retry together", () => {
  describe("given the limiter is composed outside retry", () => {
    it("holds one slot for the whole statement, retries included", async () => {
      // The ordering that matters. Inside-out, a retrying statement releases
      // its slot and rejoins the queue behind fresh work, which is how a small
      // overload becomes a persistent one.
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1 });
      const seen: number[] = [];
      let attempts = 0;

      const flaky: QueryExecutor = async () => {
        seen.push(limiter.stats().inFlight);
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("socket"), { code: "ECONNRESET" });
        }
        return { rows: [] };
      };

      await compose([
        rateLimit({ limiter }),
        retry({ maxAttempts: 5, sleep: async () => undefined }),
      ])(flaky)(request);

      expect(attempts).toBe(3);
      // One slot, held throughout - never released and re-acquired.
      expect(seen).toEqual([1, 1, 1]);
      expect(limiter.stats()).toEqual({ inFlight: 0, queued: 0 });
    });
  });
});
