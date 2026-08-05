import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
  type WindowFragment,
} from "../windowed-read";

const TABLE = "windowed_read_test";

/** Reads the counter straight off the registry — a spy on a destructured copy
 *  would intercept nothing and pass regardless. */
async function outcomeCount(outcome: string): Promise<number> {
  const { register } = await import("prom-client");
  const metric = await register
    .getSingleMetric("clickhouse_windowed_read_total")
    ?.get();
  return (
    metric?.values.find(
      (v) => v.labels.table === TABLE && v.labels.outcome === outcome,
    )?.value ?? 0
  );
}

/** Captures every window `run` was called with, resolving each attempt in order. */
function fakeRun<T>(results: T[]) {
  const windows: (WindowFragment | null)[] = [];
  let call = 0;
  const run = vi.fn(async (window: WindowFragment | null) => {
    windows.push(window);
    return results[call++]!;
  });
  return { run, windows };
}

describe("queryWindowed", () => {
  describe("given a hint whose window has rows", () => {
    it("runs the windowed attempt once and records a hit", async () => {
      const before = await outcomeCount("hit");
      const { run } = fakeRun([["row"]]);

      const result = await queryWindowed({
        table: TABLE,
        hintMs: 1_000_000,
        fallback: "unbounded",
        isEmpty: (rows: string[]) => rows.length === 0,
        run,
      });

      expect(result).toEqual(["row"]);
      expect(run).toHaveBeenCalledTimes(1);
      expect(await outcomeCount("hit")).toBe(before + 1);
    });

    it("passes a ±DEFAULT_PARTITION_WINDOW_MS fragment with fromMs/toMs params", async () => {
      const { run, windows } = fakeRun([["row"]]);

      await queryWindowed({
        table: TABLE,
        hintMs: 1_000_000,
        fallback: "unbounded",
        isEmpty: (rows: string[]) => rows.length === 0,
        run,
      });

      const frag = windows[0]!;
      expect(frag).not.toBeNull();
      expect(frag!.fromMs).toBe(1_000_000 - DEFAULT_PARTITION_WINDOW_MS);
      expect(frag!.toMs).toBe(1_000_000 + DEFAULT_PARTITION_WINDOW_MS);
      expect(frag!.params).toEqual({
        fromMs: 1_000_000 - DEFAULT_PARTITION_WINDOW_MS,
        toMs: 1_000_000 + DEFAULT_PARTITION_WINDOW_MS,
      });
      expect(frag!.sqlFor("StartTime")).toBe(
        "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
          "AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})",
      );
    });

    it("honours an explicit windowMs override", async () => {
      const { run, windows } = fakeRun([["row"]]);

      await queryWindowed({
        table: TABLE,
        hintMs: 500,
        windowMs: 100,
        fallback: "unbounded",
        isEmpty: (rows: string[]) => rows.length === 0,
        run,
      });

      expect(windows[0]!.fromMs).toBe(400);
      expect(windows[0]!.toMs).toBe(600);
    });
  });

  describe("given a hint whose window is empty", () => {
    describe("when the fallback is unbounded", () => {
      it("re-runs with a null (unbounded) fragment and records unbounded_hit", async () => {
        const before = await outcomeCount("unbounded_hit");
        const { run, windows } = fakeRun([[], ["row"]]);

        const result = await queryWindowed({
          table: TABLE,
          hintMs: 42,
          fallback: "unbounded",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        expect(result).toEqual(["row"]);
        expect(run).toHaveBeenCalledTimes(2);
        expect(windows[1]).toBeNull();
        expect(await outcomeCount("unbounded_hit")).toBe(before + 1);
      });

      it("records unbounded_empty when the widened scan is also empty", async () => {
        const before = await outcomeCount("unbounded_empty");
        const { run } = fakeRun([[], []]);

        await queryWindowed({
          table: TABLE,
          hintMs: 42,
          fallback: "unbounded",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        expect(run).toHaveBeenCalledTimes(2);
        expect(await outcomeCount("unbounded_empty")).toBe(before + 1);
      });
    });

    describe("when the fallback is none", () => {
      /**
       * A non-widening read is the one shape whose miss has nowhere else to
       * surface: there is no widen outcome to count instead. Recording it as
       * `hit` is what let a permanently-failing claim-check lookup read as a
       * healthy one while 22 groups sat blocked.
       *
       * @scenario a bounded miss is recorded as a miss, not as an answer
       */
      it("does not re-run and records the miss as windowed_empty, not hit", async () => {
        const beforeEmpty = await outcomeCount("windowed_empty");
        const beforeHit = await outcomeCount("hit");
        const { run } = fakeRun([[]]);

        const result = await queryWindowed({
          table: TABLE,
          hintMs: 42,
          fallback: "none",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        expect(result).toEqual([]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(await outcomeCount("windowed_empty")).toBe(beforeEmpty + 1);
        expect(await outcomeCount("hit")).toBe(beforeHit);
      });

      /**
       * The counterweight: splitting the empty case must not reclassify the
       * answers. A `none` read that finds its row is still a plain hit.
       *
       * @scenario a caller that forbids widening stays bounded on a miss
       */
      it("still records a hit when the window answers", async () => {
        const beforeHit = await outcomeCount("hit");
        const beforeEmpty = await outcomeCount("windowed_empty");
        const { run } = fakeRun([["row"]]);

        const result = await queryWindowed({
          table: TABLE,
          hintMs: 42,
          fallback: "none",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        expect(result).toEqual(["row"]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(await outcomeCount("hit")).toBe(beforeHit + 1);
        expect(await outcomeCount("windowed_empty")).toBe(beforeEmpty);
      });
    });

    describe("when the fallback is a lookback frame", () => {
      it("re-runs with a [now - lookbackMs, now + windowMs] fragment and records widened_hit", async () => {
        const before = await outcomeCount("widened_hit");
        vi.spyOn(Date, "now").mockReturnValue(10_000_000);
        const { run, windows } = fakeRun([[], ["row"]]);

        try {
          const result = await queryWindowed({
            table: TABLE,
            hintMs: 42,
            windowMs: 1_000,
            fallback: { lookbackMs: 5_000 },
            isEmpty: (rows: string[]) => rows.length === 0,
            run,
          });

          expect(result).toEqual(["row"]);
          expect(run).toHaveBeenCalledTimes(2);
          const frag = windows[1]!;
          expect(frag).not.toBeNull();
          expect(frag!.fromMs).toBe(10_000_000 - 5_000);
          expect(frag!.toMs).toBe(10_000_000 + 1_000);
          expect(await outcomeCount("widened_hit")).toBe(before + 1);
        } finally {
          vi.restoreAllMocks();
        }
      });

      it("records widened_empty when the lookback scan is also empty", async () => {
        const before = await outcomeCount("widened_empty");
        const { run } = fakeRun([[], []]);

        await queryWindowed({
          table: TABLE,
          hintMs: 42,
          fallback: { lookbackMs: 5_000 },
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        expect(run).toHaveBeenCalledTimes(2);
        expect(await outcomeCount("widened_empty")).toBe(before + 1);
      });
    });
  });

  describe("given no hint", () => {
    it("runs the unbounded fallback directly and records unwindowed", async () => {
      const before = await outcomeCount("unwindowed");
      const { run, windows } = fakeRun([["row"]]);

      const result = await queryWindowed({
        table: TABLE,
        hintMs: null,
        fallback: "unbounded",
        isEmpty: (rows: string[]) => rows.length === 0,
        run,
      });

      expect(result).toEqual(["row"]);
      expect(run).toHaveBeenCalledTimes(1);
      expect(windows[0]).toBeNull();
      expect(await outcomeCount("unwindowed")).toBe(before + 1);
    });

    it("runs the lookback frame directly when the fallback is a lookback", async () => {
      const before = await outcomeCount("unwindowed");
      vi.spyOn(Date, "now").mockReturnValue(20_000_000);
      const { run, windows } = fakeRun([[]]);

      try {
        await queryWindowed({
          table: TABLE,
          hintMs: null,
          windowMs: 2_000,
          fallback: { lookbackMs: 8_000 },
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        });

        const frag = windows[0]!;
        expect(frag).not.toBeNull();
        expect(frag!.fromMs).toBe(20_000_000 - 8_000);
        expect(frag!.toMs).toBe(20_000_000 + 2_000);
        expect(await outcomeCount("unwindowed")).toBe(before + 1);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe("given an attempt that throws", () => {
    it("records an error outcome and rethrows when the hinted attempt fails", async () => {
      const before = await outcomeCount("error");
      const run = vi.fn(async () => {
        throw new Error("clickhouse down");
      });

      await expect(
        queryWindowed({
          table: TABLE,
          hintMs: 1_000_000,
          fallback: "unbounded",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        }),
      ).rejects.toThrow("clickhouse down");
      expect(run).toHaveBeenCalledTimes(1);
      expect(await outcomeCount("error")).toBe(before + 1);
    });

    it("records exactly one error outcome when the widened attempt fails", async () => {
      const beforeError = await outcomeCount("error");
      const beforeHit = await outcomeCount("hit");
      let call = 0;
      const run = vi.fn(async () => {
        if (call++ === 0) return [] as string[];
        throw new Error("widen failed");
      });

      await expect(
        queryWindowed({
          table: TABLE,
          hintMs: 1_000_000,
          fallback: "unbounded",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        }),
      ).rejects.toThrow("widen failed");
      expect(run).toHaveBeenCalledTimes(2);
      expect(await outcomeCount("error")).toBe(beforeError + 1);
      expect(await outcomeCount("hit")).toBe(beforeHit);
    });

    it("records an error outcome when the unwindowed attempt fails", async () => {
      const before = await outcomeCount("error");
      const run = vi.fn(async () => {
        throw new Error("no luck");
      });

      await expect(
        queryWindowed({
          table: TABLE,
          hintMs: null,
          fallback: "unbounded",
          isEmpty: (rows: string[]) => rows.length === 0,
          run,
        }),
      ).rejects.toThrow("no luck");
      expect(await outcomeCount("error")).toBe(before + 1);
    });
  });
});
