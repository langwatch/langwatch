import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveShutdownBudget } from "../budget";

// vitest runs with isolate:false, so raw process.env mutation leaks across
// files. stubEnv is scoped and unwound by unstubAllEnvs below.
afterEach(() => vi.unstubAllEnvs());

/** platform/app/src/server/shutdown/__tests__ -> repo root */
const REPO_ROOT = resolve(__dirname, "../../../../../..");

describe("resolveShutdownBudget", () => {
  describe("given any drain budget", () => {
    describe("when the clocks are derived", () => {
      // The whole point of the module: four clocks that used to be four
      // literals in four files, where the app's 5s force-exit sat inside the
      // queue's 20s drain and silently won.
      /** @scenario Every shutdown clock nests inside the one outside it */
      it("orders them strictly innermost to outermost", () => {
        for (const drain of ["1000", "20000", "60000", "600000"]) {
          vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", drain);
          const b = resolveShutdownBudget();

          expect(b.queueDrainMs).toBeLessThan(b.appCloseMs);
          expect(b.appCloseMs).toBeLessThan(b.processDeadlineMs);
          expect(b.processDeadlineMs).toBeLessThan(
            b.requiredGracePeriodSeconds * 1000,
          );
        }
      });

      /** @scenario Raising the drain budget widens every clock above it */
      it("moves the outer clocks with the drain", () => {
        vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "20000");
        const base = resolveShutdownBudget();
        vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "120000");
        const raised = resolveShutdownBudget();

        expect(raised.appCloseMs - base.appCloseMs).toBe(100_000);
        expect(raised.processDeadlineMs - base.processDeadlineMs).toBe(100_000);
        expect(
          raised.requiredGracePeriodSeconds - base.requiredGracePeriodSeconds,
        ).toBe(100);
      });

      // The margin over the drain is written down in three places that no
      // types connect: this module, the Helm guard's `add $drain 30`, and the
      // chart suite's REQUIRED_MARGIN_SECONDS. Asserting the module against
      // itself would be a tautology — it is true for any constants — so this
      // reads the other two out of their own files. If any one is retuned
      // alone, the chart admits a release the kubelet kills mid-drain, which
      // is the exact failure the guard exists to catch.
      /** @scenario The required grace period matches what the chart guard enforces */
      it("requires drain + 30s, the same margin the chart and its suite use", () => {
        vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "20000");
        const b = resolveShutdownBudget();
        expect(b.requiredGracePeriodSeconds).toBe(50);

        const marginSeconds =
          b.requiredGracePeriodSeconds - b.queueDrainMs / 1000;

        const helpers = readFileSync(
          resolve(REPO_ROOT, "charts/langwatch/templates/_helpers.tpl"),
          "utf8",
        );
        const helperMargin = helpers.match(
          /\$required\s*:=\s*add\s+\$drain\s+(\d+)/,
        );
        expect(helperMargin?.[1]).toBeDefined();
        expect(Number(helperMargin?.[1])).toBe(marginSeconds);

        const suite = readFileSync(
          resolve(REPO_ROOT, "charts/langwatch/tests/workers-shutdown.sh"),
          "utf8",
        );
        const suiteMargin = suite.match(/REQUIRED_MARGIN_SECONDS=(\d+)/);
        expect(suiteMargin?.[1]).toBeDefined();
        expect(Number(suiteMargin?.[1])).toBe(marginSeconds);
      });
    });
  });

  describe("given no override", () => {
    describe("when the budget is resolved", () => {
      // The two numbers an operator actually asked for. Production gets a real
      // drain; a developer waiting that long for Ctrl-C is worse than losing a
      // job on a local queue.
      /** @scenario The drain budget defaults to 25s in production and 5s in dev */
      it("defaults to 25s, and 5s under a development environment", () => {
        vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "");

        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ENVIRONMENT", "");
        expect(resolveShutdownBudget().queueDrainMs).toBe(25_000);

        vi.stubEnv("NODE_ENV", "development");
        expect(resolveShutdownBudget().queueDrainMs).toBe(5_000);

        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ENVIRONMENT", "local");
        expect(resolveShutdownBudget().queueDrainMs).toBe(5_000);
      });

      // The margin is pinned across layers above; the drain itself needs the
      // same treatment, or the chart can keep sizing pods for 25s after this
      // module moves to 30s and every assertion still passes.
      /** @scenario The chart is sized for the same production drain the code uses */
      it("agrees with the chart's default drain and its suite", () => {
        vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "");
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("ENVIRONMENT", "");
        const drainSeconds = resolveShutdownBudget().queueDrainMs / 1000;

        const read = (p: string) => readFileSync(resolve(REPO_ROOT, p), "utf8");

        const values = read("charts/langwatch/values.yaml");
        const declared = [
          ...values.matchAll(/^\s+shutdownDrainSeconds:\s*(\d+)/gm),
        ].map((m) => Number(m[1]));
        // One per component (app, workers) — both must match, and there must
        // be at least one, or a rename would make this vacuous.
        expect(declared.length).toBeGreaterThan(0);
        for (const value of declared) expect(value).toBe(drainSeconds);

        const suite = read("charts/langwatch/tests/workers-shutdown.sh");
        expect(Number(suite.match(/DRAIN_SECONDS=(\d+)/)?.[1])).toBe(
          drainSeconds,
        );

        const helpers = read("charts/langwatch/templates/_helpers.tpl");
        const fallbacks = [
          ...helpers.matchAll(/shutdownDrainSeconds"?\s+"fallback"\s+(\d+)/g),
        ].map((m) => Number(m[1]));
        // Counted before comparing: a loop over zero matches passes happily,
        // which would turn this whole guard into decoration the day someone
        // reformats the helper's arguments.
        expect(fallbacks.length).toBe(2);
        for (const fallback of fallbacks) expect(fallback).toBe(drainSeconds);
      });
    });
  });

  describe("given a malformed override", () => {
    describe("when the budget is resolved", () => {
      // Throwing here would be fail-fast in the wrong place: budget.ts is on
      // the boot path of every process, so one bad character in a value that
      // only matters at shutdown would crashloop the whole fleet. The chart
      // refuses to render such a value, so this branch means a hand-set env.
      /** @scenario A malformed drain override is reported and falls back, never fatal */
      it("keeps booting on a bad value and says so", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          for (const bad of ["nonsense", "0", "-5"]) {
            vi.stubEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", bad);
            expect(() => resolveShutdownBudget()).not.toThrow();
            expect(resolveShutdownBudget().queueDrainMs).toBeGreaterThan(0);
            expect(err).toHaveBeenCalledWith(
              expect.stringContaining("SHUTDOWN_DRAIN_TIMEOUT_MS"),
            );
            err.mockClear();
          }
        } finally {
          err.mockRestore();
        }
      });
    });
  });
});
