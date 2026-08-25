/**
 * @vitest-environment node
 *
 * specs/observability/slow-work-warnings.feature, the Postgres half.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  reportQueryDuration,
  resetSlowQueryThrottle,
  resolveSlowQueryBudgetMs,
  withQueryTiming,
} from "../dbSlowQueryWarning";

const BUDGET_MS = 500;
const THROTTLE_MS = 60_000;

beforeEach(() => {
  warn.mockClear();
  resetSlowQueryThrottle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Postgres slow-query warning", () => {
  describe("given a budget of 500 milliseconds", () => {
    describe("when a query finishes inside the budget", () => {
      /** @scenario "A query inside the budget is not warned about" */
      it("logs no warning", () => {
        reportQueryDuration({
          model: "Scenario",
          action: "findFirst",
          args: { where: { id: "x" } },
          durationMs: 20,
          budgetMs: BUDGET_MS,
          now: 0,
        });

        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe("when a query runs over the budget", () => {
      /** @scenario "A query over the budget is warned about" */
      it("warns, naming the model, the operation, the duration and the budget", () => {
        reportQueryDuration({
          model: "Scenario",
          action: "findFirst",
          args: { where: { id: "x" } },
          durationMs: 900,
          budgetMs: BUDGET_MS,
          now: 0,
        });

        expect(warn).toHaveBeenCalledTimes(1);
        const [fields, message] = warn.mock.calls[0]!;
        expect(fields).toMatchObject({
          source: "postgres",
          model: "Scenario",
          operation: "findFirst",
          durationMs: 900,
          budgetMs: BUDGET_MS,
        });
        expect(message).toContain("Scenario.findFirst");
        expect(message).toContain("900ms");
      });
    });

    describe("when the budget is set to zero", () => {
      /** @scenario "A query inside the budget is not warned about" */
      it("turns the warning off entirely", () => {
        reportQueryDuration({
          model: "Scenario",
          action: "findFirst",
          args: {},
          durationMs: 10_000,
          budgetMs: 0,
          now: 0,
        });

        expect(warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a slow operation that fails", () => {
    describe("when the operation rejects after exceeding the budget", () => {
      /** @scenario "A failing query is left to the caller to report" */
      it("re-raises the error and logs no warning", async () => {
        // One reading, not two: the rejection propagates out of the await, so
        // the finish reading is never taken and nothing is reported. Counting
        // the readings is what proves that, rather than inferring it from the
        // absence of a warning, which a fast call would produce too.
        const clock = vi.spyOn(performance, "now").mockReturnValue(0);
        const boom = new Error("connection reset");

        await expect(
          withQueryTiming({
            params: { model: "Scenario", action: "findFirst", args: {} },
            run: () => Promise.reject(boom),
          }),
        ).rejects.toBe(boom);

        expect(clock).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe("when the same operation instead succeeds over the budget", () => {
      /** @scenario "A query over the budget is warned about" */
      it("warns, which is what makes the rejecting case above non-vacuous", async () => {
        vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(900);

        await expect(
          withQueryTiming({
            params: { model: "Scenario", action: "findFirst", args: {} },
            run: () => Promise.resolve("ok"),
          }),
        ).resolves.toBe("ok");

        expect(warn).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a slow query carrying customer data", () => {
    describe("when the query filters on an email address", () => {
      /** @scenario "Argument values are not logged" */
      it("lists the argument keys and never the values", () => {
        reportQueryDuration({
          model: "User",
          action: "findFirst",
          args: {
            where: { email: "someone@acme.example" },
            include: { org: true },
          },
          durationMs: 900,
          budgetMs: BUDGET_MS,
          now: 0,
        });

        const [fields, message] = warn.mock.calls[0]!;
        expect(fields.argKeys).toEqual(["where", "include"]);
        expect(JSON.stringify(fields)).not.toContain("someone@acme.example");
        expect(message).not.toContain("someone@acme.example");
      });
    });

    describe("when a raw query runs slowly", () => {
      /** @scenario "A raw query does not log its SQL" */
      it("names the operation as raw and reports no argument keys", () => {
        reportQueryDuration({
          action: "queryRaw",
          args: [['SELECT * FROM "User" WHERE email = $1'], "someone@acme.example"],
          durationMs: 900,
          budgetMs: BUDGET_MS,
          now: 0,
        });

        const [fields, message] = warn.mock.calls[0]!;
        expect(fields.operation).toBe("queryRaw");
        expect(fields.argKeys).toBeUndefined();
        expect(JSON.stringify(fields)).not.toContain("SELECT");
        expect(message).not.toContain("SELECT");
      });
    });
  });

  describe("given a query that is slow on every call", () => {
    const runSlowly = ({
      times,
      now,
      model = "Scenario",
    }: {
      times: number;
      now: number;
      model?: string;
    }) => {
      for (let i = 0; i < times; i++) {
        reportQueryDuration({
          model,
          action: "findFirst",
          args: {},
          durationMs: 900,
          budgetMs: BUDGET_MS,
          now,
        });
      }
    };

    describe("when it runs 50 times inside one throttle interval", () => {
      /** @scenario "The same slow query warns once per interval" */
      it("warns once", () => {
        runSlowly({ times: 50, now: 0 });

        expect(warn).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the interval elapses and it runs slowly again", () => {
      /** @scenario "A throttled warning states how many calls it stands for" */
      it("reports how many calls the throttle suppressed", () => {
        runSlowly({ times: 50, now: 0 });
        warn.mockClear();

        runSlowly({ times: 1, now: THROTTLE_MS });

        expect(warn).toHaveBeenCalledTimes(1);
        // 50 calls, the first of which warned: 49 went unreported.
        expect(warn.mock.calls[0]![0]).toMatchObject({
          suppressedSincePrevious: 49,
        });
      });
    });

    describe("when a different model is also slow inside the interval", () => {
      /** @scenario "A different query is not throttled by its neighbour" */
      it("warns for each identity separately", () => {
        runSlowly({ times: 1, now: 0, model: "Scenario" });
        runSlowly({ times: 1, now: 0, model: "Project" });

        expect(warn).toHaveBeenCalledTimes(2);
      });
    });
  });
});

describe("the slow-query budget", () => {
  describe("when the environment does not set one", () => {
    it("falls back to the default", () => {
      expect(resolveSlowQueryBudgetMs({})).toBe(500);
    });
  });

  describe("when the environment sets one", () => {
    it("uses it", () => {
      expect(resolveSlowQueryBudgetMs({ POSTGRES_SLOW_QUERY_MS: "1200" })).toBe(1200);
    });
  });

  describe("when the environment sets something unparseable", () => {
    it("keeps the default rather than disabling the warning", () => {
      expect(resolveSlowQueryBudgetMs({ POSTGRES_SLOW_QUERY_MS: "soon" })).toBe(500);
    });
  });
});
