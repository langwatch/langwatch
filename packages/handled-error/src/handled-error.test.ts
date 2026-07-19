import { describe, expect, it, vi } from "vitest";

import {
  HandledError,
  NotFoundError,
  handledErrorFromHerr,
  setTraceUrlProvider,
} from "./index";

class TestError extends HandledError {
  declare readonly code: "test_error";

  constructor(
    message = "something broke",
    options: ConstructorParameters<typeof HandledError>[2] = {},
  ) {
    super("test_error", message, options);
    this.name = "TestError";
  }
}

describe("HandledError.serialize", () => {
  it("defaults fault to customer and omits empty remediation fields", () => {
    const serialized = new TestError().serialize();

    expect(serialized.fault).toBe("customer");
    expect(serialized).not.toHaveProperty("tips");
    expect(serialized).not.toHaveProperty("docsUrl");
  });

  it("serializes tips, docsUrl and fault", () => {
    const serialized = new TestError("boom", {
      fault: "platform",
      tips: ["Try a smaller time range", "Select fewer fields"],
      docsUrl: "https://docs.langwatch.ai/traces",
    }).serialize();

    expect(serialized.fault).toBe("platform");
    expect(serialized.tips).toEqual([
      "Try a smaller time range",
      "Select fewer fields",
    ]);
    expect(serialized.docsUrl).toBe("https://docs.langwatch.ai/traces");
  });

  it("carries remediation fields through nested reasons and masks plain errors", () => {
    const err = new TestError("outer", {
      reasons: [
        new TestError("inner", { tips: ["inner tip"], docsUrl: "https://x" }),
        new Error("secret internals"),
      ],
    });

    const [handled, masked] = err.serialize().reasons;
    expect(handled).toMatchObject({
      code: "test_error",
      tips: ["inner tip"],
      docsUrl: "https://x",
    });
    expect(masked).toEqual({ code: "unknown", kind: "unknown" });
  });

  it("uses the configured trace URL provider", () => {
    const provider = vi.fn((traceId: string | undefined) =>
      traceId ? `https://grafana/${traceId}` : undefined,
    );
    setTraceUrlProvider(provider);
    try {
      new TestError().serialize();
      // No active span in tests → no traceId → provider consulted with undefined.
      expect(provider).toHaveBeenCalledWith(undefined);

      const withIds = new TestError("with ids", { traceId: "abc123" });
      expect(withIds.serialize().traceUrl).toBe("https://grafana/abc123");
      expect(provider).toHaveBeenCalledWith("abc123");
    } finally {
      setTraceUrlProvider(() => undefined);
    }
  });
});

describe("handledErrorFromHerr", () => {
  it("maps the herr envelope remediation fields", () => {
    const err = handledErrorFromHerr({
      type: "budget_exceeded",
      message: "spending limit reached",
      meta: { limit: 100 },
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      fault: "customer",
      tips: ["Contact your admin to raise the limit"],
      docs_url: "https://docs.langwatch.ai/gateway/budgets",
      reasons: [{ type: "unknown", message: "unknown" }],
    });

    expect(err.code).toBe("budget_exceeded");
    expect(err.fault).toBe("customer");
    expect(err.tips).toEqual(["Contact your admin to raise the limit"]);
    expect(err.docsUrl).toBe("https://docs.langwatch.ai/gateway/budgets");
    // Wire ids are preserved on the error itself, not buried in meta.
    expect(err.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(err.spanId).toBe("b7ad6b7169203331");
    expect(err.meta).not.toHaveProperty("traceId");
    expect(err.serialize().reasons[0]).toMatchObject({ code: "unknown" });
  });

  it("round-trips tips/docsUrl through serialize", () => {
    const err = handledErrorFromHerr({
      type: "rate_limited",
      message: "slow down",
      tips: ["Back off and retry"],
      docs_url: "https://docs.langwatch.ai/gateway/rate-limits",
    });

    const serialized = err.serialize();
    expect(serialized.tips).toEqual(["Back off and retry"]);
    expect(serialized.docsUrl).toBe(
      "https://docs.langwatch.ai/gateway/rate-limits",
    );
  });
});

describe("NotFoundError", () => {
  it("accepts remediation options", () => {
    const err = new NotFoundError("trace_not_found", "Trace", "abc", {
      tips: ["Check the trace id"],
      docsUrl: "https://docs.langwatch.ai/traces",
    });

    expect(err.httpStatus).toBe(404);
    expect(err.meta).toMatchObject({ id: "abc" });
    expect(err.serialize().tips).toEqual(["Check the trace id"]);
  });
});
