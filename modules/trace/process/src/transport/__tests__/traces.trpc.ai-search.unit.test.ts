/**
 * @vitest-environment node
 * Ask AI and Enter-on-a-sentence: each procedure hands the trace module the
 * viewer's proof and window, and answers what it answers.
 * @see modules/trace/specs/trace-ai-search.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000, live: true };
const PROOF = expect.objectContaining({
  grants: [expect.objectContaining({ projectId: PROJECT_ID, kind: "own" })],
});
const PROMPT = "traces with errors";

function harness() {
  const aiQuery = vi.fn<TraceApi["aiQuery"]>(async () => ({
    ok: true,
    query: "status:error",
    attempts: 1,
  }));
  const aiAction = vi.fn<TraceApi["aiAction"]>(async () => ({
    ok: true,
    kind: "apply_query",
    query: "status:error",
  }));
  const routeSearch = vi.fn<TraceApi["routeSearch"]>(async () => ({
    kind: "filter",
    query: "status:error",
    decidedBy: "model",
  }));
  const app = createApiFixture<TraceApi>({ aiQuery, aiAction, routeSearch });

  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(tracesTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "viewer-1" } }),
    aiQuery,
    aiAction,
    routeSearch,
  };
}

describe("given a viewer on the trace explorer's AI search", () => {
  /** @scenario "The AI search procedures hand the viewer's proof to the trace module" */
  it("asks AI with the viewer's proof and the window without its live flag", async () => {
    const { caller, aiAction } = harness();

    await expect(
      caller.aiAction({ projectId: PROJECT_ID, prompt: PROMPT, timeRange: TIME_RANGE }),
    ).resolves.toEqual({ ok: true, kind: "apply_query", query: "status:error" });
    expect(aiAction).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      authorization: PROOF,
      prompt: PROMPT,
      timeRange: { from: 1_000, to: 2_000 },
    });
  });

  /** @scenario "The AI search procedures hand the viewer's proof to the trace module" */
  it("composes a query with the viewer's proof", async () => {
    const { caller, aiQuery } = harness();

    await expect(
      caller.aiQuery({ projectId: PROJECT_ID, prompt: PROMPT, timeRange: TIME_RANGE }),
    ).resolves.toEqual({ ok: true, query: "status:error", attempts: 1 });
    expect(aiQuery).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      authorization: PROOF,
      prompt: PROMPT,
      timeRange: { from: 1_000, to: 2_000 },
    });
  });

  /** @scenario "The AI search procedures hand the viewer's proof to the trace module" */
  it("routes a sentence on Enter with the viewer's proof", async () => {
    const { caller, routeSearch } = harness();

    await expect(
      caller.routeSearch({ projectId: PROJECT_ID, text: PROMPT, timeRange: TIME_RANGE }),
    ).resolves.toEqual({ kind: "filter", query: "status:error", decidedBy: "model" });
    expect(routeSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        authorization: PROOF,
        text: PROMPT,
        activeQuery: "",
      }),
    );
  });
});
