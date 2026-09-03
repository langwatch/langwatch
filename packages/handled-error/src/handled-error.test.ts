import { describe, expect, it, vi } from "vitest";
import {
  HandledError,
  handledErrorFromHerr,
  NotFoundError,
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

async function duplicatedHandledError(
  code: string,
  message: string,
  httpStatus = 404,
): Promise<HandledError> {
  vi.resetModules();
  const duplicateModule = await import("./handled-error");
  class DuplicatedHandledError extends duplicateModule.HandledError {
    constructor() {
      super(code, message, { httpStatus });
    }
  }
  return new DuplicatedHandledError();
}

describe("HandledError.serialize", () => {
  it("defaults fault to customer, retryable to false, and omits empty remediation fields", () => {
    const serialized = new TestError().serialize();

    expect(serialized.fault).toBe("customer");
    expect(serialized.retryable).toBe(false);
    expect(serialized).not.toHaveProperty("tips");
    expect(serialized).not.toHaveProperty("docsUrl");
  });

  it("serializes tips, docsUrl, fault and retryable", () => {
    const serialized = new TestError("boom", {
      fault: "platform",
      retryable: true,
      tips: ["Try a smaller time range", "Select fewer fields"],
      docsUrl: "https://docs.langwatch.ai/traces",
    }).serialize();

    expect(serialized.fault).toBe("platform");
    expect(serialized.retryable).toBe(true);
    expect(serialized.tips).toEqual(["Try a smaller time range", "Select fewer fields"]);
    expect(serialized.docsUrl).toBe("https://docs.langwatch.ai/traces");
  });

  it("serializes trusted errors through the package implementation", () => {
    class OverriddenSerializerError extends TestError {
      override serialize(): never {
        throw new Error("untrusted override called");
      }
    }

    const serialized = HandledError.serializeTrusted(new OverriddenSerializerError());

    expect(serialized.code).toBe("test_error");
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
      retryable: false,
      tips: ["inner tip"],
      docsUrl: "https://x",
    });
    expect(masked).toEqual({
      code: "unknown",
      kind: "unknown",
      retryable: false,
    });
  });

  it("folds a reason's message into meta.message so the prose survives serialization", () => {
    // A herr-deserialized cause carries its prose on `.message` (FromBody
    // promotes meta.message to the wire message) — the serialized reason must
    // keep it, or "credit balance too low" degrades to a bare code.
    const providerMessage = "Your credit balance is too low to access the Anthropic API.";
    const err = new TestError("outer", {
      reasons: [
        handledErrorFromHerr({
          type: "llm_upstream_error",
          message: providerMessage,
          meta: { http_status: 400 },
        }),
      ],
    });

    const [reason] = err.serialize().reasons;
    expect(reason!.meta).toMatchObject({
      message: providerMessage,
      http_status: 400,
    });
  });

  it("keeps an explicit meta.message over the error message and skips code-echo messages", () => {
    const explicit = new TestError("outer", {
      reasons: [new TestError("real prose", { meta: { message: "authored wins" } })],
    });
    expect(explicit.serialize().reasons[0]!.meta).toMatchObject({
      message: "authored wins",
    });

    // A message that merely repeats the code adds nothing.
    const echo = new TestError("outer", {
      reasons: [new TestError("test_error")],
    });
    expect(echo.serialize().reasons[0]!.meta).toBeUndefined();
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
      retryable: true,
      tips: ["Contact your admin to raise the limit"],
      docs_url: "https://docs.langwatch.ai/gateway/budgets",
      reasons: [{ type: "unknown", message: "unknown" }],
    });

    expect(err.code).toBe("budget_exceeded");
    expect(err.fault).toBe("customer");
    expect(err.retryable).toBe(true);
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
    expect(serialized.docsUrl).toBe("https://docs.langwatch.ai/gateway/rate-limits");
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

describe("HandledError.isHandled", () => {
  it("matches a real HandledError instance", () => {
    expect(HandledError.isHandled(new TestError())).toBe(true);
  });

  it("matches an instance constructed through a duplicated module evaluation", async () => {
    const duplicate = await duplicatedHandledError("span_not_found", "gone");

    expect(duplicate instanceof HandledError).toBe(true);
    expect(HandledError.isHandled(duplicate)).toBe(true);
  });

  it("shares trace URL configuration across duplicated module evaluations", async () => {
    vi.resetModules();
    const duplicateModule = await import("./handled-error");
    duplicateModule.setTraceUrlProvider((traceId) =>
      traceId ? `https://traces.example/${traceId}` : void 0,
    );

    const error = new TestError("boom", { traceId: "trace-1" });

    expect(HandledError.serializeTrusted(error).traceUrl).toBe(
      "https://traces.example/trace-1",
    );
    setTraceUrlProvider(() => void 0);
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["a serialised payload with no brand", { code: "x", httpStatus: 500 }],
    // A structured clone / JSON round-trip keeps the brand but loses the
    // prototype, so `.serialize()` would not exist — must not match.
    ["a cloned payload carrying the brand", { isHandled: true, code: "x" }],
    ["a non-true brand", { isHandled: "yes" }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "span_not_found"],
  ])("rejects %s", (_label, value) => {
    expect(HandledError.isHandled(value)).toBe(false);
  });
});

describe("HandledError.isUnhandled", () => {
  it("does not treat a registry-issued HandledError as infrastructure failure", () => {
    const duplicate = new TestError();
    expect(HandledError.isUnhandled(duplicate)).toBe(false);
  });

  it("still treats a plain Error as unhandled", () => {
    expect(HandledError.isUnhandled(new Error("db exploded"))).toBe(true);
  });
});

describe("HandledError.is", () => {
  it("narrows to the concrete subclass within one module graph", () => {
    expect(TestError.is(new TestError())).toBe(true);
    expect(NotFoundError.is(new TestError())).toBe(false);
  });

  it("stays subclass-specific across a duplicated module evaluation", async () => {
    const duplicate = await duplicatedHandledError("test_error", "gone");
    expect(TestError.is(duplicate)).toBe(false);
    expect(duplicate.code).toBe("test_error");
  });
});

describe("HandledError.toUserMessage", () => {
  it("forwards the message of a duplicated HandledError", async () => {
    const duplicate = await duplicatedHandledError(
      "span_not_found",
      "That span no longer exists",
    );
    expect(HandledError.toUserMessage(duplicate)).toBe("That span no longer exists");
  });

  it("masks an unhandled error and reports it to the log callback", () => {
    const unhandled = new Error("connection reset by peer");
    const logged: unknown[] = [];

    expect(HandledError.toUserMessage(unhandled, (e) => logged.push(e))).toBe(
      "An unknown error occurred",
    );
    expect(logged).toEqual([unhandled]);
  });
});

describe("serialising a reason chain", () => {
  it("keeps the code of a duplicated nested reason instead of masking it", async () => {
    const duplicate = await duplicatedHandledError("span_not_found", "no span");
    const error = new TestError("could not build preview", {
      reasons: [duplicate],
    });

    expect(error.serialize().reasons).toEqual([
      {
        code: "span_not_found",
        kind: "span_not_found",
        fault: "customer",
        retryable: false,
        // The reason's own prose survives via the meta.message channel.
        meta: { message: "no span" },
      },
    ]);
  });

  it("still masks a genuinely unknown reason", () => {
    const error = new TestError("could not build preview", {
      reasons: [new Error("connection reset by peer")],
    });

    expect(error.serialize().reasons).toEqual([
      { code: "unknown", kind: "unknown", retryable: false },
    ]);
  });
});
