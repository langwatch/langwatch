import * as observability from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENGINE_GATE_CACHE_TTL_MS } from "../authz-cutover-gate.service.ts";
import { ObservabilityAuthzCutoverAdapter } from "../authz-cutover-telemetry.service.ts";

// A `vi.mock("@langwatch/observability", ...)` factory is a package-wide
// replacement: under this package's non-isolated vitest pool (`isolate:
// false` + `singleFork: true`), several files replace the same module and
// whichever factory wins for the whole run. Spying on the already-resolved
// namespace instead mutates the one shared object, so it can't lose that race.
const warn = vi.fn();

beforeEach(() => {
  warn.mockClear();
  vi.spyOn(observability, "createLogger").mockReturnValue({ warn } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservabilityAuthzCutoverAdapter", () => {
  it("logs and increments for a reopened legacy window", () => {
    const counter = { inc: vi.fn() };
    const reporter = ObservabilityAuthzCutoverAdapter.create({ counter });
    const error = new Error("pg is down");

    reporter.report({
      organizationId: "org-1",
      error,
      ttlMs: ENGINE_GATE_CACHE_TTL_MS,
    });

    expect(warn).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        error,
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      },
      expect.any(String),
    );
    expect(counter.inc).toHaveBeenCalledOnce();
  });
});
