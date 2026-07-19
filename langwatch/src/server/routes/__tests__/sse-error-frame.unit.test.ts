import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { sseErrorFrame } from "../sse";

class TestHandledError extends HandledError {
  declare readonly code: "test_handled";

  constructor() {
    super("test_handled", "a fixable failure", {
      httpStatus: 422,
      tips: ["Do the thing"],
      docsUrl: "https://docs.langwatch.ai/x",
    });
    this.name = "TestHandledError";
  }
}

describe("sseErrorFrame", () => {
  it("carries the full serialized domain error for a bare HandledError", () => {
    const frame = sseErrorFrame(new TestHandledError());

    expect(frame.type).toBe("error");
    expect(frame.message).toBe("a fixable failure");
    expect(frame.domainError).toMatchObject({
      code: "test_handled",
      httpStatus: 422,
      tips: ["Do the thing"],
      docsUrl: "https://docs.langwatch.ai/x",
      fault: "customer",
    });
  });

  it("unwraps a HandledError carried as a TRPCError cause", () => {
    const frame = sseErrorFrame(
      new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "a fixable failure",
        cause: new TestHandledError(),
      }),
    );

    expect(frame.message).toBe("a fixable failure");
    expect(frame.domainError).toMatchObject({ code: "test_handled" });
  });

  it("keeps the message of a client-safe TRPCError without a domain payload", () => {
    const frame = sseErrorFrame(
      new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" }),
    );

    expect(frame).toEqual({ type: "error", message: "Unauthorized" });
  });

  it("masks unhandled errors instead of leaking the raw message", () => {
    const frame = sseErrorFrame(
      new Error("postgres connection string: db.internal:5432"),
    );

    expect(frame).toEqual({
      type: "error",
      message: "An unknown error occurred",
    });
  });

  it("masks internal TRPCErrors without a handled cause", () => {
    const frame = sseErrorFrame(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "raw internals",
      }),
    );

    expect(frame.message).toBe("An unknown error occurred");
    expect(frame.domainError).toBeUndefined();
  });
});
