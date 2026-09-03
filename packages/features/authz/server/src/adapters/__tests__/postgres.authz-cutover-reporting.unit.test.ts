import { describe, expect, it, vi } from "vitest";
import { ObservabilityAuthzCutoverAdapter } from "../observability.authz-cutover.adapter";
import { ENGINE_GATE_CACHE_TTL_MS } from "../postgres.authz-cutover.adapter";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

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
