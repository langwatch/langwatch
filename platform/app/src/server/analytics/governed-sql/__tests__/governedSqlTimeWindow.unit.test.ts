/**
 * The time-window contract on its own: how an instant is spelled for the
 * database, and what a surface may and may not do with the two reserved names.
 *
 * Driven directly rather than through the service, because these are the rules
 * every surface inherits — a refusal proven here is a refusal REST, tRPC and
 * the saved-chart write path all get for free, and none of them can restate it.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import { pinTimezone } from "~/test-utils/pinTimezone";

import { resolveGovernedTimeWindow } from "../resolveTimeWindow";
import {
  formatGovernedDateTimeParameter,
  isGovernedSqlDateTimeParameterType,
} from "../timeWindow";
import type { GovernedSqlParameter } from "../validation/validate";

const PERIOD: GovernedSqlParameter[] = [
  { name: "period_start", type: "DateTime" },
  { name: "period_end", type: "DateTime" },
];

const WINDOW = {
  start: new Date("2026-02-20T00:00:00.000Z"),
  end: new Date("2026-02-27T00:00:00.000Z"),
};

/** The `code` of a thrown handled error, or the reason there is none. */
function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "<no error was thrown>";
}

function metaOf(run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    return ((error as { meta?: Record<string, unknown> }).meta ?? {}) as Record<
      string,
      unknown
    >;
  }
  return {};
}

/**
 * A zone the process is pinned to while the format is under test.
 *
 * Without it the whole group is vacuous wherever `TZ` is UTC — which is most
 * CI runners — because an implementation reading the *local* getters would
 * agree with a correct one on every instant. At UTC-3 it disagrees, and the
 * instant below is chosen so it disagrees about the calendar day too.
 */
const NON_UTC_ZONE = "America/Sao_Paulo";

describe("given an instant to hand the database", () => {
  pinTimezone(NON_UTC_ZONE);

  describe("when it is formatted as a bound parameter", () => {
    /** @scenario "The injected window is a UTC ClickHouse date-time, not an ISO-8601 instant" */
    it("spells it as a space-separated UTC date-time with no zone designator", () => {
      expect(
        formatGovernedDateTimeParameter(new Date("2026-02-20T12:34:56.000Z")),
      ).toBe("2026-02-20 12:34:56");
    });

    /** @scenario "The injected window is a UTC ClickHouse date-time, not an ISO-8601 instant" */
    it("reads the instant in UTC rather than in whatever zone the process runs in", () => {
      // 2026-02-21 01:30 UTC is 2026-02-20 22:30 in the pinned zone, so the
      // hour AND the calendar day differ. Reading the local getters would spell
      // this "2026-02-20 22:30:00" and this case would go red.
      const acrossMidnight = new Date("2026-02-21T01:30:00.000Z");
      expect(new Date(acrossMidnight).getDate(), NON_UTC_ZONE).toBe(20);

      expect(formatGovernedDateTimeParameter(acrossMidnight)).toBe(
        "2026-02-21 01:30:00",
      );
      // The same instant written the way `toISOString` would: the `T` and the
      // `Z` are exactly what the DateTime binding does not read.
      expect(formatGovernedDateTimeParameter(acrossMidnight)).not.toContain(
        "T",
      );
      expect(formatGovernedDateTimeParameter(acrossMidnight)).not.toContain(
        "Z",
      );
    });

    /** @scenario "The injected window is a UTC ClickHouse date-time, not an ISO-8601 instant" */
    it("truncates below the second and pads every field to its width", () => {
      expect(
        formatGovernedDateTimeParameter(new Date("2026-02-03T04:05:06.789Z")),
      ).toBe("2026-02-03 04:05:06");
    });

    it("refuses an invalid date rather than spelling it as text", () => {
      expect(() =>
        formatGovernedDateTimeParameter(new Date("nonsense")),
      ).toThrow();
    });
  });
});

describe("given a declared parameter type", () => {
  describe("when it is measured against what may carry an instant", () => {
    /** @scenario "A reserved period parameter declared as anything but a date-time is refused" */
    it("accepts the date-time spellings and nothing else", () => {
      for (const type of [
        "DateTime",
        "DateTime('UTC')",
        "DateTime64(3)",
        "DateTime64(3, 'UTC')",
      ]) {
        expect(isGovernedSqlDateTimeParameterType(type), type).toBe(true);
      }
      for (const type of [
        "String",
        "UInt64",
        "Date",
        "Date32",
        "Nullable(DateTime)",
      ]) {
        expect(isGovernedSqlDateTimeParameterType(type), type).toBe(false);
      }
    });
  });
});

describe("given a statement and the window a surface is showing", () => {
  describe("when the statement declares both reserved names", () => {
    /** @scenario "A statement declaring the reserved period parameters is given the surface's window" */
    it("binds each to its end of the window, and says the statement follows it", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: PERIOD,
        timeWindow: WINDOW,
      });

      expect(resolved.parameters).toEqual({
        period_start: "2026-02-20 00:00:00",
        period_end: "2026-02-27 00:00:00",
      });
      expect(resolved.followsTimeWindow).toBe(true);
      expect(resolved.awaitingTimeWindow).toEqual([]);
    });

    it("keeps the caller's own parameters beside the injected ones", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: [...PERIOD, { name: "name", type: "String" }],
        parameters: { name: "checkout" },
        timeWindow: WINDOW,
      });

      expect(resolved.parameters).toEqual({
        name: "checkout",
        period_start: "2026-02-20 00:00:00",
        period_end: "2026-02-27 00:00:00",
      });
    });
  });

  describe("when the statement declares only one of them", () => {
    /** @scenario "A statement declaring only one reserved period parameter is given that one" */
    it("binds the one it declared and sends no value for the other", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: [{ name: "period_start", type: "DateTime" }],
        timeWindow: WINDOW,
      });

      expect(resolved.parameters).toEqual({
        period_start: "2026-02-20 00:00:00",
      });
      expect(resolved.followsTimeWindow).toBe(true);
    });
  });

  describe("when the statement declares neither", () => {
    /** @scenario "A statement with no period parameters runs, and says so" */
    it("injects nothing and reports that it does not follow the period", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: [{ name: "name", type: "String" }],
        parameters: { name: "checkout" },
        timeWindow: WINDOW,
      });

      expect(resolved.parameters).toEqual({ name: "checkout" });
      expect(resolved.followsTimeWindow).toBe(false);
      expect(resolved.awaitingTimeWindow).toEqual([]);
    });

    it("leaves an unparameterised statement with no parameters at all", () => {
      expect(
        resolveGovernedTimeWindow({ declared: [], timeWindow: WINDOW })
          .parameters,
      ).toBeUndefined();
    });
  });

  /**
   * Pinned, not endorsed.
   *
   * A window whose end precedes its start, or whose ends coincide, is bound
   * exactly as it arrives; the half-open comparison then matches no row and the
   * member gets an empty answer rather than a refusal. Nothing in the resolver
   * inspects the order, and these two cases exist so that giving it an opinion
   * later is a deliberate edit to this file rather than a behavior change
   * nobody notices — the surfaces above are what own the period, and a resolver
   * that second-guesses one of them would be a second place the window can be
   * decided.
   */
  describe("when the window is inverted or has no width", () => {
    it("binds an inverted window exactly as given, refusing nothing", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: PERIOD,
        timeWindow: { start: WINDOW.end, end: WINDOW.start },
      });

      expect(resolved.parameters).toEqual({
        period_start: "2026-02-27 00:00:00",
        period_end: "2026-02-20 00:00:00",
      });
      expect(resolved.followsTimeWindow).toBe(true);
      expect(resolved.awaitingTimeWindow).toEqual([]);
    });

    it("binds a zero-width window exactly as given, refusing nothing", () => {
      const resolved = resolveGovernedTimeWindow({
        declared: PERIOD,
        timeWindow: { start: WINDOW.start, end: WINDOW.start },
      });

      expect(resolved.parameters).toEqual({
        period_start: "2026-02-20 00:00:00",
        period_end: "2026-02-20 00:00:00",
      });
      expect(resolved.followsTimeWindow).toBe(true);
      expect(resolved.awaitingTimeWindow).toEqual([]);
    });
  });

  describe("when no window is supplied at all", () => {
    /** @scenario "A period-aware statement run with no window names what is unset" */
    it("defers the declared reserved names rather than refusing them", () => {
      const resolved = resolveGovernedTimeWindow({ declared: PERIOD });

      expect(resolved.awaitingTimeWindow).toEqual([
        "period_end",
        "period_start",
      ]);
      expect(resolved.followsTimeWindow).toBe(true);
      expect(resolved.parameters).toBeUndefined();
    });
  });
});

describe("given a request that reaches for a name the surface owns", () => {
  describe("when it carries a value for a reserved name", () => {
    /** @scenario "A caller that supplies a reserved period parameter itself is refused" */
    it("refuses, naming what it may not set", () => {
      const run = () =>
        resolveGovernedTimeWindow({
          declared: PERIOD,
          parameters: { period_start: "2020-01-01 00:00:00" },
          timeWindow: WINDOW,
        });

      expect(codeOf(run)).toBe("governed_sql_reserved_parameter_supplied");
      expect(metaOf(run)).toEqual({ parameters: ["period_start"] });
    });

    /** @scenario "A caller that supplies a reserved period parameter itself is refused" */
    it("refuses even when the statement never declared it", () => {
      expect(
        codeOf(() =>
          resolveGovernedTimeWindow({
            declared: [],
            parameters: { period_end: "2020-01-01 00:00:00" },
          }),
        ),
      ).toBe("governed_sql_reserved_parameter_supplied");
    });
  });

  describe("when a reserved name is declared as something other than a date-time", () => {
    /** @scenario "A reserved period parameter declared as anything but a date-time is refused" */
    it("refuses, naming the declaration to rewrite", () => {
      const run = () =>
        resolveGovernedTimeWindow({
          declared: [{ name: "period_start", type: "String" }],
          timeWindow: WINDOW,
        });

      expect(codeOf(run)).toBe("governed_sql_reserved_parameter_type");
      expect(metaOf(run)).toEqual({ parameters: ["period_start"] });
    });

    /**
     * The statement's own defect is named before the request's, so an author
     * with a mistyped declaration is told to fix the declaration whether or not
     * they also sent a value for it.
     */
    it("names the type before the supplied value when both are wrong", () => {
      expect(
        codeOf(() =>
          resolveGovernedTimeWindow({
            declared: [{ name: "period_start", type: "String" }],
            parameters: { period_start: "2020-01-01 00:00:00" },
          }),
        ),
      ).toBe("governed_sql_reserved_parameter_type");
    });
  });
});
