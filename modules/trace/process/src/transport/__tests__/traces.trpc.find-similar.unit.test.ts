/**
 * @vitest-environment node
 * `traces.findSimilar`: the nearest traces by clustering embedding.
 * @see modules/trace/specs/similar-traces.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { isSealedAuthorization } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { SimilarTracesResult, TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const ANSWER: SimilarTracesResult = {
  status: "ready",
  embeddingsModel: "text-embedding-3-small",
  traces: [{ traceId: "trace-2", occurredAtMs: 1_000, distance: 0.1 }],
};

function harness({ permits }: { permits: (permission: string) => boolean }) {
  const findSimilarTraces = vi.fn<TraceApi["findSimilarTraces"]>(async () => ANSWER);
  const app = createApiFixture<TraceApi>({ findSimilarTraces });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits }),
  }).mount(tracesTrpcTransport, () => app);

  return { caller: router.createCaller({ actor: { id: "reader-1" } }), findSimilarTraces };
}

describe("traces.findSimilar", () => {
  describe("when a viewer with traces:view asks", () => {
    /** @scenario "The similar traces read asks for traces:view" */
    it("hands the app the parsed input, the default limit and the route's proof", async () => {
      const { caller, findSimilarTraces } = harness({ permits: () => true });

      const result = await caller.findSimilar({ projectId: "project-1", traceId: "trace-1" });

      expect(result).toEqual(ANSWER);
      const [input] = findSimilarTraces.mock.calls[0]!;
      expect(input).toMatchObject({ projectId: "project-1", traceId: "trace-1", limit: 10 });
      expect(isSealedAuthorization(input.authorization)).toBe(true);
    });
  });

  describe("when the viewer lacks traces:view", () => {
    /** @scenario "The similar traces read asks for traces:view" */
    it("refuses before the app is asked", async () => {
      const { caller, findSimilarTraces } = harness({
        permits: (permission) => permission !== "traces:view",
      });

      await expect(
        caller.findSimilar({ projectId: "project-1", traceId: "trace-1" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(findSimilarTraces).not.toHaveBeenCalled();
    });
  });

  describe("when the limit is above the ceiling", () => {
    it("refuses the input", async () => {
      const { caller, findSimilarTraces } = harness({ permits: () => true });

      await expect(
        caller.findSimilar({ projectId: "project-1", traceId: "trace-1", limit: 51 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(findSimilarTraces).not.toHaveBeenCalled();
    });
  });
});
