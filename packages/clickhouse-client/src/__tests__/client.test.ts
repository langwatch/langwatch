import { describe, expect, it, vi } from "vitest";
import { ClickHouseQueryClient } from "../client";
import type { QueryRequest } from "../query";
import { ConcurrencyLimiter } from "../rateLimit";
import { RetryPolicy } from "../retry";
import { TenantGuard, TenantScopeError } from "../tenantGuard";
import { QueryTracer } from "../tracing";

/**
 * The order the client runs its policies in.
 *
 * This is the whole reason the class exists rather than a bag of helpers, and
 * every step of it is a decision someone made after an incident — so each is
 * pinned here rather than left to the prose on the class. The nesting is not
 * visible from any single collaborator's own tests: only running them together
 * can show that a retry keeps its concurrency slot, or that a refused statement
 * never reached the driver.
 */

const request = (overrides: Partial<QueryRequest> = {}): QueryRequest => ({
  tenantId: "project_abc",
  sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_abc" },
  ...overrides,
});

describe("ClickHouseQueryClient", () => {
  describe("given no policies at all", () => {
    describe("when a statement is executed", () => {
      it("passes it straight to the driver", async () => {
        const execute = vi.fn(async () => ({ rows: [1] }));
        const client = new ClickHouseQueryClient({ driver: { execute } });

        await expect(client.query(request())).resolves.toEqual({ rows: [1] });
        expect(execute).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a tenant guard", () => {
    describe("when the statement has no tenant predicate", () => {
      /**
       * Outermost, so refusing costs nothing. If the guard ran anywhere else a
       * statement that must not run would still have taken a concurrency slot
       * and a span on its way to being refused.
       */
      it("refuses before the driver is reached", async () => {
        const execute = vi.fn(async () => ({ rows: [] }));
        const client = new ClickHouseQueryClient({
          driver: { execute },
          tenantGuard: new TenantGuard(),
        });

        await expect(
          client.query(request({ sql: "SELECT 1 FROM t", params: {} })),
        ).rejects.toBeInstanceOf(TenantScopeError);
        expect(execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("given both a concurrency limiter and a retry policy", () => {
    describe("when an attempt fails and is retried", () => {
      /**
       * The slot is held across retries, not taken per attempt. Inside the
       * retry loop, a retrying statement would release its slot, rejoin the
       * back of the queue and compete with fresh work — which is how a queue
       * turns a small overload into a persistent one (2026-07-31).
       *
       * Proven by contention rather than by a count. Sampling `inFlight` from
       * inside the driver cannot tell the two arrangements apart: a limiter
       * *inside* retry reacquires before each attempt and reads 1 just the
       * same. The only observable difference is whether other work can take
       * the slot mid-retry, so a second statement is offered the single slot
       * while the first is between attempts, and must not get it.
       */
      it("holds its slot across a retry, so waiting work cannot start between attempts", async () => {
        const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
        const FIRST = "SELECT 1 FROM t WHERE TenantId = {tenantId:String}";
        const SECOND = "SELECT 2 FROM t WHERE TenantId = {tenantId:String}";

        const started: string[] = [];
        let attempts = 0;
        let isRetrySleepEntered = false;
        let releaseRetrySleep: (() => void) | undefined;
        const retrySleepReleased = new Promise<void>((resolve) => {
          releaseRetrySleep = resolve;
        });

        const execute = vi.fn(async ({ sql }: QueryRequest) => {
          started.push(sql === FIRST ? "first" : "second");
          if (sql === FIRST) {
            attempts += 1;
            if (attempts === 1) throw new Error("socket hang up");
          }
          return { rows: [] };
        });

        const client = new ClickHouseQueryClient({
          driver: { execute },
          limiter,
          retries: new RetryPolicy({
            sleep: async () => {
              isRetrySleepEntered = true;
              await retrySleepReleased;
            },
            random: () => 0,
            // Named explicitly: the classifier is owned by the caller so it
            // cannot drift from the job queue's, so the default list is
            // deliberately empty of host-specific strings.
            transientMessageFragments: ["socket hang up"],
          }),
        });

        const first = client.query(request({ sql: FIRST }));
        // The first attempt has failed and the policy is now backing off.
        await vi.waitFor(() => expect(isRetrySleepEntered).toBe(true));

        const second = client.query(request({ sql: SECOND }));
        await vi.waitFor(() => expect(limiter.stats().queued).toBe(1));

        // The retrying statement still owns the only slot: had the limiter sat
        // inside the retry loop, `second` would have been admitted by now.
        expect(started).toEqual(["first"]);
        expect(limiter.stats()).toEqual({ inFlight: 1, queued: 1 });

        releaseRetrySleep?.();
        await expect(first).resolves.toEqual({ rows: [] });
        await expect(second).resolves.toEqual({ rows: [] });

        // The retry ran to completion before the queued statement was admitted.
        expect(started).toEqual(["first", "first", "second"]);
        expect(attempts).toBe(2);
        expect(limiter.stats()).toEqual({ inFlight: 0, queued: 0 });
      });
    });

    describe("when the wait queue is full", () => {
      it("sheds rather than queueing further", async () => {
        const limiter = new ConcurrencyLimiter({
          maxConcurrent: 1,
          maxQueued: 0,
        });
        let release: (() => void) | undefined;
        const client = new ClickHouseQueryClient({
          driver: {
            execute: async () =>
              new Promise((resolve) => {
                release = () => resolve({ rows: [] });
              }),
          },
          limiter,
        });

        const first = client.query(request());
        await vi.waitFor(() => expect(release).toBeDefined());

        await expect(client.query(request())).rejects.toThrow(/queue is full/);

        release?.();
        await first;
      });
    });
  });

  describe("given a tracer and a limiter", () => {
    describe("when the statement waits for a slot", () => {
      /**
       * The span opens before the wait, so queue time is inside it. Time spent
       * waiting is latency the caller experienced; a span started after the
       * wait would report a fast query on a slow request.
       */
      it("opens the span before the slot is acquired", async () => {
        const events: string[] = [];
        const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
        const span = {
          setAttribute: () => {},
          recordError: () => {},
          end: () => events.push("span.end"),
        };

        // Occupy the only slot so the next statement has to wait.
        let release: (() => void) | undefined;
        const blocker = limiter.run(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        );
        await vi.waitFor(() => expect(release).toBeDefined());

        const client = new ClickHouseQueryClient({
          driver: {
            execute: async () => {
              events.push("driver");
              return { rows: [] };
            },
          },
          limiter,
          tracer: new QueryTracer({
            tracer: {
              startSpan: () => {
                events.push("span.start");
                return span;
              },
            },
          }),
        });

        const pending = client.query(request());
        await vi.waitFor(() => expect(events).toContain("span.start"));
        // The span is open while the statement is still queued.
        expect(events).toEqual(["span.start"]);

        release?.();
        await blocker;
        await pending;

        expect(events).toEqual(["span.start", "driver", "span.end"]);
      });
    });
  });
});
