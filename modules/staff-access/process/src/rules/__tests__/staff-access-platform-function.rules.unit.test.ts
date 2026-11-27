/** @see modules/staff-access/specs/staff-access-functions-platform.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  imageTagOf,
  plainWordOf,
  upgradeErrorCodeOf,
  utcMonthsUntil,
} from "../staff-access-platform-function.rules.ts";

describe("the platform ops function rules", () => {
  /** @scenario "A service role or image tag that is not a plain word reads as other" */
  it("reads a role or image tag with spaces or slashes as other", () => {
    expect(plainWordOf("api")).toBe("api");
    expect(plainWordOf("api server")).toBe("other");
    expect(plainWordOf("api/ACME")).toBe("other");
    expect(imageTagOf("ghcr.io/langwatch/langwatch:3.24.0@sha256:feed")).toBe("3.24.0");
    expect(imageTagOf("langwatch")).toBe("latest");
    expect(imageTagOf("langwatch:ACME build")).toBe("other");
    expect(imageTagOf("")).toBe("other");
  });

  /** @scenario "An upgrade error with no code reads as other" */
  it("keeps a leading code, names a target failure and reads free text as other", () => {
    expect(upgradeErrorCodeOf("ACME's spans could not be read")).toBe("other");
    expect(upgradeErrorCodeOf("clickhouse_timeout: SELECT took 30s")).toBe("clickhouse_timeout");
    expect(upgradeErrorCodeOf("failed on 2 of 3 targets")).toBe("targets_failed");
    expect(upgradeErrorCodeOf("release 3.24.0 declares no such step")).toBe("step_not_declared");
  });

  it("answers 12 UTC months oldest first, the last ending at the asked time", () => {
    const at = Temporal.Instant.from("2026-11-02T10:00:00Z");

    const months = utcMonthsUntil({ at, count: 12 });

    expect(months.map((month) => month.key)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(months[0]?.since).toBe(Date.parse("2025-12-01T00:00:00Z"));
    expect(months[10]?.until).toBe(Date.parse("2026-11-01T00:00:00Z"));
    expect(months[11]?.until).toBe(at.epochMilliseconds);
  });
});
