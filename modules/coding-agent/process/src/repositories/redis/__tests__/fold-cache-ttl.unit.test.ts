import { describe, expect, it } from "vitest";
import { buildTestCodingAgentProcessingPipeline } from "../../../__tests__/fixtures/coding-agent-processing.fixture.ts";

describe("coding-agent Eventing fold cache", () => {
  it("forwards the process-configured TTL to its session cache", () => {
    const pipeline = buildTestCodingAgentProcessingPipeline(undefined, 600);
    const definition = pipeline.foldProjections.get("codingAgentSession")?.definition;
    const store = definition?.store as { ttlSeconds?: number } | undefined;

    expect(store?.ttlSeconds).toBe(600);
  });
});
