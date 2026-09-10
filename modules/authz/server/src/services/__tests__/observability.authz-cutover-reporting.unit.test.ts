import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as observability from "@langwatch/observability";
import { ObservabilityAuthzCutoverAdapter } from "../authz-cutover-telemetry.service.ts";
import { ENGINE_GATE_CACHE_TTL_MS } from "../authz-cutover-gate.service.ts";

// A `vi.mock("@langwatch/observability", ...)` factory is a package-wide
// module replacement: under this package's non-isolated vitest pool
// (packages/test-harness/src/vitest-config.ts, `isolate: false` +
// `singleFork: true`), several other test files replace the same module the
// same way, and whichever file's factory the shared module registry keeps
// wins for the rest of the run. Spying on the already-resolved namespace
// instead mutates the one shared object every file already sees, so it
// cannot lose that race.
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
