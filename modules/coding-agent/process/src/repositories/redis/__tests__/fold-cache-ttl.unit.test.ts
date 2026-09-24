import { describe, expect, it } from "vitest";

import { buildTestCodingAgentProcessingPipeline } from "../../../__tests__/fixtures/coding-agent-processing.fixture.ts";

describe("coding-agent Eventing fold cache", () => {
  it("forwards the process-configured TTL to its session cache", () => {
    const pipeline = buildTestCodingAgentProcessingPipeline(undefined, 600);
    const fold = pipeline.foldProjections.get("codingAgentSession");
    const store = fold?.open((definition): object => definition.store);

    expect(store && "ttlSeconds" in store ? store.ttlSeconds : undefined).toBe(600);
  });
});
