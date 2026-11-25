import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { describe, expect, it } from "vitest";

import { usageCountingOf, withUsageCountedElsewhere } from "../trace-request-usage.rules.ts";

const SKIP_KEY = "langwatch.reserved.skip_token_accumulation";

function span({
  name = "anthropic.messages.create",
  requestId = "req_011",
}: {
  name?: string;
  requestId?: string | null;
}): OtlpSpan {
  return {
    traceId: "c1a0de0e1e5700000000000000000001",
    spanId: "aaaa000000000001",
    name,
    kind: 3,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes:
      requestId === null
        ? []
        : [{ key: "anthropic.request.id", value: { stringValue: requestId } }],
    events: [],
    links: [],
    status: { code: null, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("usageCountingOf", () => {
  describe("given a Claude SDK or Claude API messages.create span with a request id", () => {
    it("keys the usage record by the request id, the same for both sources", () => {
      const fromSdk = usageCountingOf({ span: span({}), scopeName: "com.anthropic.sdk.go" });
      const fromApi = usageCountingOf({
        span: span({}),
        scopeName: "com.anthropic.claude-platform",
      });

      expect(fromSdk).toEqual({ kind: "per-request", recordId: "anthropic.request:req_011" });
      expect(fromApi).toEqual(fromSdk);
    });
  });

  describe("given a span that reports no request of its own", () => {
    it.each([
      [
        "a model request",
        span({ name: "anthropic.model_request" }),
        "com.anthropic.claude-platform",
      ],
      ["no request id", span({ requestId: null }), "com.anthropic.sdk.python"],
      ["another instrumentation", span({}), "openinference.instrumentation.anthropic"],
      ["Claude Code", span({}), "com.anthropic.claude_code"],
      ["no scope", span({}), undefined],
    ])("counts the usage per span for %s", (_label, candidate, scopeName) => {
      expect(usageCountingOf({ span: candidate, scopeName })).toEqual({ kind: "per-span" });
    });
  });
});

describe("withUsageCountedElsewhere", () => {
  it("marks a copy once, leaving the span and its usage as they were", () => {
    const original = span({});
    original.attributes.push({ key: SKIP_KEY, value: { stringValue: "false" } });

    const marked = withUsageCountedElsewhere(original);

    expect(marked.attributes.filter((attribute) => attribute.key === SKIP_KEY)).toEqual([
      { key: SKIP_KEY, value: { stringValue: "true" } },
    ]);
    expect(original.attributes.find((attribute) => attribute.key === SKIP_KEY)?.value).toEqual({
      stringValue: "false",
    });
    expect(marked.attributes).toContainEqual(original.attributes[0]);
  });
});
