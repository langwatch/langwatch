import { HandledError } from "@langwatch/handled-error";
import type { TRPCDefaultErrorShape } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createTrpcErrorFormatter } from "../runtime.ts";

// Rulings 2026-10-06, round 9 (CH-1): a transient 503 refusal keeps its body over tRPC too.

class TransientRefusal extends HandledError {
  constructor({ code, message }: { code: string; message: string }) {
    super(code, message, { httpStatus: 503, fault: "platform", retryable: true });
    this.name = "TransientRefusal";
  }
}

const formatter = createTrpcErrorFormatter({
  causePayload: { payloadFor: () => null },
  traceIds: { find: () => "trace-1" } as never,
});

const unavailableShape: TRPCDefaultErrorShape = {
  message: "the framework's own words",
  code: -32603,
  data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503, path: "x" },
};

const format = (cause: unknown) =>
  formatter({ shape: unavailableShape, error: { cause, code: "SERVICE_UNAVAILABLE" } });

describe("the tRPC error formatter, given a transient 503 refusal", () => {
  /** @scenario "A transient refusal keeps its body over tRPC" */
  it.each([
    { code: "clickhouse_overloaded", message: "Too many queries in flight" },
    { code: "service_unavailable", message: "This deployment has no trace recorder." },
  ])("keeps $code and its status, which the browser presents by code", ({ code, message }) => {
    const formatted = format(new TransientRefusal({ code, message }));

    expect(formatted.message).toBe(code);
    expect(formatted.data.error).toMatchObject({ code, httpStatus: 503, retryable: true });
  });
});
