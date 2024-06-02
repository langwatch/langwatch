import { LangWatch } from "./index";
import { describe, it, expect } from "vitest";

describe("LangWatch tracer", () => {
  it("captures traces correctly", () => {
    const langwatch = new LangWatch();
    const trace = langwatch.getTrace();
    trace.update({ metadata: { threadId: "123", userId: "123" } });
    trace.update({ metadata: { userId: "456" } });

    const span = trace.startSpan({ name: "test" });
    span.end();

    expect(trace.metadata).toEqual({ threadId: "123", userId: "456" });
    expect(span.timestamps.startedAt).toBeDefined();
    expect(span.timestamps.finishedAt).toBeDefined();

    console.log("trace.enqueued", JSON.stringify(trace.enqueued, undefined, 2));
  });
});
