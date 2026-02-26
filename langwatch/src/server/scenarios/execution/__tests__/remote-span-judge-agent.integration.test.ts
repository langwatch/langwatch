/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Span } from "../../../tracer/types";
import { RemoteSpanJudgeAgent } from "../remote-span-judge-agent";

function createTestSpan(overrides: Partial<Span> = {}): Span {
  return {
    span_id: "span_abc",
    trace_id: "trace_abc",
    type: "llm",
    name: "user-agent-call",
    timestamps: { started_at: 1000, finished_at: 2000 },
    ...overrides,
  } as Span;
}

describe("RemoteSpanJudgeAgent", () => {
  const defaultInput: AgentInput = {
    threadId: "test-thread",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ],
    newMessages: [],
    requestedRole: AgentRole.JUDGE,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
    judgmentRequest: {
      criteria: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has JUDGE role", () => {
    const agent = new RemoteSpanJudgeAgent({
      criteria: ["test"],
      model: undefined,
      projectId: "project_123",
      querySpans: vi.fn().mockResolvedValue([]),
    });

    expect(agent.role).toBe(AgentRole.JUDGE);
  });

  it("has criteria from params", () => {
    const agent = new RemoteSpanJudgeAgent({
      criteria: ["criterion-1", "criterion-2"],
      model: undefined,
      projectId: "project_123",
      querySpans: vi.fn().mockResolvedValue([]),
    });

    expect(agent.criteria).toEqual(["criterion-1", "criterion-2"]);
  });

  describe("when trace ID is set explicitly", () => {
    it("queries remote spans before delegating to judge", async () => {
      const querySpans = vi.fn().mockResolvedValue([
        createTestSpan({ name: "tool-call", span_id: "s1" }),
      ]);

      const agent = new RemoteSpanJudgeAgent({
        criteria: ["Agent must use tools"],
        model: undefined,
        projectId: "project_123",
        querySpans,
        traceId: "abcdef1234567890abcdef1234567890",
        spanCollectionTimeoutMs: 200,
      });

      // The delegate judge will fail without a model, but we're testing
      // that querySpans is called before delegation
      try {
        await agent.call(defaultInput);
      } catch {
        // Expected - no model configured for actual LLM call
      }

      expect(querySpans).toHaveBeenCalledWith({
        projectId: "project_123",
        traceId: "abcdef1234567890abcdef1234567890",
      });
    });

    it("uses trace ID set via setTraceId()", async () => {
      const querySpans = vi.fn().mockResolvedValue([]);

      const agent = new RemoteSpanJudgeAgent({
        criteria: ["Agent must respond"],
        model: undefined,
        projectId: "project_123",
        querySpans,
        spanCollectionTimeoutMs: 200,
      });

      agent.setTraceId("trace_set_later");

      try {
        await agent.call(defaultInput);
      } catch {
        // Expected - no model configured
      }

      expect(querySpans).toHaveBeenCalledWith({
        projectId: "project_123",
        traceId: "trace_set_later",
      });
    });
  });

  describe("when no trace ID is provided", () => {
    it("skips remote span collection and delegates directly", async () => {
      const querySpans = vi.fn();

      const agent = new RemoteSpanJudgeAgent({
        criteria: ["Agent must respond"],
        model: undefined,
        projectId: "project_123",
        querySpans,
      });

      try {
        await agent.call(defaultInput);
      } catch {
        // Expected - no model configured
      }

      expect(querySpans).not.toHaveBeenCalled();
    });
  });
});
