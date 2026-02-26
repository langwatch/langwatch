/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentInput, JudgeAgentConfig } from "@langwatch/scenario";
import { bridgeTraceIdFromAdapterToJudge } from "../bridge-trace-id";
import { RemoteSpanJudgeAgent } from "../remote-span-judge-agent";

// Mock the remote span collector's dependencies so we can construct the judge
vi.mock("../remote-span-collector", () => ({
  collectRemoteSpans: vi.fn().mockResolvedValue({
    getSpansForThread: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock("@langwatch/scenario", async (importOriginal) => {
  const original = await importOriginal<typeof import("@langwatch/scenario")>();
  return {
    ...original,
    judgeAgent: vi.fn().mockReturnValue({
      call: vi.fn().mockResolvedValue({ passed: true, reasoning: "ok" }),
    }),
  };
});

function createMockAdapter(traceId: string | undefined) {
  return {
    getTraceId: vi.fn().mockReturnValue(traceId),
  };
}

function createJudge(): RemoteSpanJudgeAgent {
  return new RemoteSpanJudgeAgent({
    criteria: ["test criterion"],
    model: { provider: "openai", model: "gpt-4o" } as unknown as JudgeAgentConfig["model"],
    projectId: "project_123",
    querySpans: vi.fn().mockResolvedValue([]),
  });
}

const stubInput: AgentInput = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: "judge" as AgentInput["requestedRole"],
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

describe("bridgeTraceIdFromAdapterToJudge()", () => {
  describe("when adapter has a captured trace ID", () => {
    it("passes the trace ID to the judge via setTraceId before call", async () => {
      const adapter = createMockAdapter("abc123def456");
      const judge = createJudge();
      const setTraceIdSpy = vi.spyOn(judge, "setTraceId");

      bridgeTraceIdFromAdapterToJudge({ adapter, judge });
      await judge.call(stubInput);

      expect(adapter.getTraceId).toHaveBeenCalled();
      expect(setTraceIdSpy).toHaveBeenCalledWith("abc123def456");
    });
  });

  describe("when adapter has no trace ID", () => {
    it("does not call setTraceId on the judge", async () => {
      const adapter = createMockAdapter(undefined);
      const judge = createJudge();
      const setTraceIdSpy = vi.spyOn(judge, "setTraceId");

      bridgeTraceIdFromAdapterToJudge({ adapter, judge });
      await judge.call(stubInput);

      expect(adapter.getTraceId).toHaveBeenCalled();
      expect(setTraceIdSpy).not.toHaveBeenCalled();
    });
  });

  describe("when called multiple times", () => {
    it("uses the latest trace ID from the adapter each time", async () => {
      const adapter = createMockAdapter("first_trace_id");
      const judge = createJudge();
      const setTraceIdSpy = vi.spyOn(judge, "setTraceId");

      bridgeTraceIdFromAdapterToJudge({ adapter, judge });

      await judge.call(stubInput);
      expect(setTraceIdSpy).toHaveBeenCalledWith("first_trace_id");

      // Simulate adapter capturing a new trace ID on subsequent call
      adapter.getTraceId.mockReturnValue("second_trace_id");
      await judge.call(stubInput);
      expect(setTraceIdSpy).toHaveBeenCalledWith("second_trace_id");
    });
  });
});
