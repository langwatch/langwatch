/**
 * @vitest-environment node
 * The correction's write door: `annotations:update` is asked before the handler runs.
 * @see specs/traces-v2/trace-edit-overlay.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { traceEditOverlayPatchSchema, type TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { traceEditOverlayTrpcTransport } from "../trace-edit-overlay.trpc.ts";

type TestContext = { actor: { id: string } };

const INPUT = {
  projectId: "project-1",
  traceId: "trace-1",
  patch: traceEditOverlayPatchSchema.parse({
    version: 1,
    spans: [{ spanId: "span-1", name: "cleaned up" }],
  }),
};

function harness({ permitted }: { permitted: readonly string[] }) {
  const saveTraceEditOverlayAsViewer = vi.fn<TraceApi["saveTraceEditOverlayAsViewer"]>();
  const app = createApiFixture<TraceApi>({ saveTraceEditOverlayAsViewer });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => permitted.includes(permission),
    }),
  }).mount(traceEditOverlayTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "viewer-1" } }),
    saveTraceEditOverlayAsViewer,
  };
}

describe("given a reviewer who may view the project but not update its annotations", () => {
  describe("when they save a correction for a trace", () => {
    /** @scenario Saving a correction without permission to update annotations is refused */
    it("is refused before the handler stores anything", async () => {
      const { caller, saveTraceEditOverlayAsViewer } = harness({ permitted: ["traces:view"] });

      await expect(caller.upsert(INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(saveTraceEditOverlayAsViewer).not.toHaveBeenCalled();
    });
  });
});
