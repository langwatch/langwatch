import { describe, expect, it } from "vitest";
import {
  serializedHandledErrorSchema,
  serializedReasonSchema,
  type SerializedHandledError,
  type SerializedReason,
} from "./index";

describe("serialized handled-error schemas", () => {
  it("normalizes a legacy kind-only payload and its reason defaults", () => {
    const parsed = serializedHandledErrorSchema.parse({
      kind: "evaluation_failed",
      httpStatus: 422,
      reasons: [{ kind: "provider_timeout" }],
    });

    const error: SerializedHandledError = parsed;

    expect(error).toMatchObject({
      code: "evaluation_failed",
      kind: "evaluation_failed",
      meta: {},
      httpStatus: 422,
      fault: "customer",
      retryable: false,
      reasons: [
        {
          code: "provider_timeout",
          kind: "provider_timeout",
          retryable: false,
        },
      ],
    });
    expect(error.traceId).toBeUndefined();
    expect(error.spanId).toBeUndefined();
  });

  it("validates the full recursive reason chain", () => {
    const parsed = serializedHandledErrorSchema.parse({
      code: "evaluation_failed",
      kind: "evaluation_failed",
      meta: {},
      httpStatus: 500,
      fault: "platform",
      reasons: [
        {
          code: "provider_unavailable",
          kind: "provider_unavailable",
          fault: "provider",
          retryable: true,
          reasons: [{ code: "timeout", kind: "timeout", tips: ["Retry shortly"] }],
        },
      ],
    });

    const firstReason = parsed.reasons[0];
    if (firstReason === void 0) {
      throw new Error("Expected the parsed error to keep its first reason");
    }

    const reason: SerializedReason = firstReason;

    expect(reason.reasons?.[0]).toMatchObject({
      code: "timeout",
      kind: "timeout",
      retryable: false,
      tips: ["Retry shortly"],
    });
  });

  it("rejects malformed nested reasons", () => {
    const parsed = serializedHandledErrorSchema.safeParse({
      code: "evaluation_failed",
      kind: "evaluation_failed",
      meta: {},
      httpStatus: 500,
      fault: "platform",
      reasons: [
        { code: "provider_unavailable", kind: "provider_unavailable", reasons: [1] },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps forward-compatible fields at every wire level", () => {
    const parsed = serializedReasonSchema.parse({
      code: "provider_unavailable",
      kind: "provider_unavailable",
      source: "gateway",
      reasons: [{ code: "timeout", kind: "timeout", retryAfterMs: 1000 }],
    });

    expect(parsed).toMatchObject({
      source: "gateway",
      reasons: [{ retryAfterMs: 1000 }],
    });
  });
});
