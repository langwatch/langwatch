import { describe, expect, it, vi } from "vitest";
import { createHttpProxyCaller } from "./http-proxy.fixture.ts";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

const request = {
  projectId: "project_1",
  agentId: "agent_1",
  url: "https://example.com/chat",
  method: "POST" as const,
  bodyTemplate: "{}",
};

function execution() {
  const executeComponent = vi.fn<WorkflowApi["executeComponent"]>().mockResolvedValue({
    status: "success",
    outputs: { output: "answer" },
  });
  const recordCapturedSpan = vi.fn<TraceApi["recordCapturedSpan"]>().mockResolvedValue(void 0);
  return {
    executeComponent,
    recordCapturedSpan,
    workflows: createApiFixture<WorkflowApi>({ executeComponent }),
    traces: createApiFixture<TraceApi>({ recordCapturedSpan }),
  };
}

describe("HTTP agent test boundary", () => {
  it("redacts credentials from whitespace-padded header names before recording history", async () => {
    const dispatch = execution();

    await createHttpProxyCaller(dispatch).execute({
      ...request,
      headers: [{ key: " Authorization ", value: "Bearer secret-token" }],
    });

    const trace = dispatch.recordCapturedSpan.mock.calls[0]?.[0];
    expect(trace?.span.input).toMatchObject({
      value: { headers: { Authorization: "Bearer [REDACTED]" } },
    });
    expect(JSON.stringify(trace)).not.toContain("secret-token");
  });
  it("rejects invalid input before reaching the engine", async () => {
    const dispatch = execution();
    const caller = createHttpProxyCaller(dispatch);

    await expect(caller.execute({ ...request, url: "not a URL" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(dispatch.executeComponent).not.toHaveBeenCalled();
    expect(dispatch.recordCapturedSpan).not.toHaveBeenCalled();
  });

  it("requires an authenticated actor before any outbound work", async () => {
    const dispatch = execution();
    const caller = createHttpProxyCaller(dispatch, null);

    await expect(caller.execute(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(dispatch.executeComponent).not.toHaveBeenCalled();
    expect(dispatch.recordCapturedSpan).not.toHaveBeenCalled();
  });

  it("hides dispatch exception content from the response and trace", async () => {
    const dispatch = execution();
    dispatch.executeComponent.mockRejectedValue(
      new Error("https://secret-token@internal.service:8000"),
    );

    const result = await createHttpProxyCaller(dispatch).execute(request);

    expect(result).toEqual({ success: false });
    expect(JSON.stringify(dispatch.recordCapturedSpan.mock.calls)).not.toContain("secret-token");
    expect(dispatch.recordCapturedSpan).toHaveBeenCalledOnce();
  });

  it("keeps a completed test successful when recording history fails", async () => {
    const dispatch = execution();
    dispatch.recordCapturedSpan.mockRejectedValue(new Error("trace storage unavailable"));

    const result = await createHttpProxyCaller(dispatch).execute(request);

    expect(result).toMatchObject({ success: true, extractedOutput: "answer" });
    expect(dispatch.executeComponent).toHaveBeenCalledOnce();
    expect(dispatch.recordCapturedSpan).toHaveBeenCalledOnce();
  });

  it("does not manufacture success when the engine sends no result", async () => {
    const dispatch = execution();
    dispatch.executeComponent.mockRejectedValue(
      new Error("The engine reported no result for this request"),
    );

    const result = await createHttpProxyCaller(dispatch).execute(request);

    expect(result).toEqual({ success: false });
    expect(dispatch.recordCapturedSpan).toHaveBeenCalledOnce();
  });
});
