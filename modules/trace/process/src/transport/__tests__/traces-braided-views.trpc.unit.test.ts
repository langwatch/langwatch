/**
 * @vitest-environment node
 * @see modules/trace/specs/braided-spans.feature
 * The drawer's views of a braided trace through the real tRPC runtime (ADR-201 §5): each asks one
 * `TraceApi` operation, for the viewer, under the route's proof; the owner protections are its.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type Context = { actor: { id: string } | null };

function mount() {
  const app = {
    readTraceEventsForViewer: vi.fn<TraceApi["readTraceEventsForViewer"]>(async () => []),
    readSpanTreePageForViewer: vi.fn<TraceApi["readSpanTreePageForViewer"]>(async () => ({
      nodes: [],
      nextCursor: null,
    })),
    readSpanTreeDeltaForViewer: vi.fn<TraceApi["readSpanTreeDeltaForViewer"]>(async () => []),
    readSpanTreeForViewer: vi.fn<TraceApi["readSpanTreeForViewer"]>(async () => []),
    readSpansPageForViewer: vi.fn<TraceApi["readSpansPageForViewer"]>(async () => ({
      spans: [],
      total: 0,
    })),
    readSpansSinceForViewer: vi.fn<TraceApi["readSpansSinceForViewer"]>(async () => []),
    readSpansFullForViewer: vi.fn<TraceApi["readSpansFullForViewer"]>(async () => []),
    readSpanResourcesForViewer: vi.fn<TraceApi["readSpanResourcesForViewer"]>(async () => ({
      rootSpanId: null,
      resourceAttributes: {},
      scope: null,
      spans: [],
    })),
  };
  const trpc = initTRPC.context<Context>().create();
  const members = trpcTestMembers<Context>({
    overrides: {
      authorization: {
        forRequest: () => ({
          ...testAuthorizeDefaults,
          getDecision: async () => ({ permitted: true, organizationRole: null }),
          getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
          checkScopeLineage: async () => ({ kind: "consistent" }),
        }),
      },
      entitlements: { holds: async () => true },
    },
  });
  const runtime = createTrpcRuntime<Context>({ root: trpc, procedure: trpc.procedure, members });
  const router = trpc.router({
    traces: runtime.mount(tracesTrpcTransport, () => createApiFixture<TraceApi>(app)),
  });
  return { app, caller: router.createCaller({ actor: { id: "user_ana" } }).traces };
}

const trace = { projectId: "project_orchestrator", traceId: "trace-1", tenantId: "project_m" };
const forTheViewer = expect.objectContaining({
  ...trace,
  viewerUserId: "user_ana",
  authorization: expect.objectContaining({ grants: expect.any(Array) }),
});

describe("the drawer's views of a braided trace", () => {
  describe("when a view is asked for", () => {
    it.each([
      ["traceEvents", "readTraceEventsForViewer", {}],
      ["spanTreePaginated", "readSpanTreePageForViewer", { limit: 50 }],
      ["spanTreeDelta", "readSpanTreeDeltaForViewer", { sinceUpdatedAtMs: 0 }],
      ["spanTree", "readSpanTreeForViewer", {}],
      ["spansPaginated", "readSpansPageForViewer", { limit: 50, offset: 0 }],
      ["spansDelta", "readSpansSinceForViewer", { sinceStartTimeMs: 0 }],
      ["spansFull", "readSpansFullForViewer", {}],
      ["resourceInfo", "readSpanResourcesForViewer", {}],
    ] as const)("%s asks %s alone, for the viewer", async (procedure, operation, extra) => {
      const { app, caller } = mount();

      await (caller[procedure] as (input: unknown) => Promise<unknown>)({ ...trace, ...extra });

      expect(app[operation]).toHaveBeenCalledTimes(1);
      expect(app[operation]).toHaveBeenCalledWith(forTheViewer);
    });
  });
});
