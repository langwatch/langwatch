/**
 * The server's sentence for a reserved name declared with the wrong type names each mistyped kind
 * once: the lists, the time zone and the period names.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import { describe, expect, it } from "vitest";

import { LangWatchQLReservedParameterTypeError } from "../langwatch-ql.errors.ts";

describe("given reserved names declared with the wrong type", () => {
  /** @scenario "TZ17 The wrong-type refusal says how to declare each mistyped name" */
  it.each([
    [
      ["dashboard_context_timezone"],
      "The query declares dashboard_context_timezone with a type other than String.",
    ],
    [
      ["dashboard_context_sources", "dashboard_context_timezone"],
      "The query declares dashboard_context_sources with a type other than Array(String), and " +
        "dashboard_context_timezone with a type other than String.",
    ],
    [
      ["dashboard_context_period_start", "dashboard_context_sources", "dashboard_context_timezone"],
      "The query declares dashboard_context_sources with a type other than Array(String), and " +
        "dashboard_context_timezone with a type other than String, and a time-window parameter " +
        "with a type that is not a date-time.",
    ],
    [
      ["dashboard_context_period_end"],
      "The query declares a time-window parameter with a type that is not a date-time.",
    ],
  ])("for %j says %j", (mistyped, message) => {
    const error = new LangWatchQLReservedParameterTypeError(mistyped);

    expect(error.code).toBe("lwql_reserved_parameter_type");
    expect(error.message).toBe(message);
    expect(error.meta).toEqual({ parameters: mistyped });
  });
});
