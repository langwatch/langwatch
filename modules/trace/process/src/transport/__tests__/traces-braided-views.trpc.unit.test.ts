/**
 * @vitest-environment node
 * @see modules/trace/specs/braided-spans.feature
 * The drawer's views of a braided trace through the real tRPC runtime (ADR-183 §5): each reads
 * `spans`, and each braided item is protected by its owner's protections, the reader's by theirs.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { Authorization } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { Protections, SpanTreeNode, TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type Context = { actor: { id: string } | null };

const READER = "project_orchestrator";
const OWNER = "project_specialists";
const readerSees: Protections = {
  canSeeCapturedInput: true,
  canSeeCosts: true,
  hiddenAttributes: [],
};
const ownerHides: Protections = {
  canSeeCapturedInput: false,
  canSeeCosts: false,
  hiddenAttributes: [{ pattern: "*", visibleTo: "members of this project" }],
};

function treeNode(node: Pick<SpanTreeNode, "spanId" | "cost" | "ownerProjectId">): SpanTreeNode {
  return {
    parentSpanId: null,
    name: "step",
    type: "llm",
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok",
    model: null,
    ...node,
  };
}

const treeNodes = [
  treeNode({ spanId: "reader-span", cost: 0.5 }),
  treeNode({ spanId: "owner-span", cost: 0.25, ownerProjectId: OWNER }),
];

function mount({ reader = readerSees, owner = ownerHides } = {}) {
  const app = {
    authorizationForTrace: vi.fn(
      async ({ authorization }: { authorization: Authorization }) => authorization,
    ),
    resolveViewerProtections: vi.fn<TraceApi["resolveViewerProtections"]>(async () => reader),
    resolveBraidOwnerProtections: vi.fn<TraceApi["resolveBraidOwnerProtections"]>(
      async ({ ownerProjectIds }) =>
        new Map(ownerProjectIds.flatMap((id) => (id ? [[id, owner] as const] : []))),
    ),
    readSpanTreePage: vi.fn<TraceApi["readSpanTreePage"]>(async () => ({
      nodes: treeNodes,
      nextCursor: null,
    })),
    readSpanTreeDelta: vi.fn<TraceApi["readSpanTreeDelta"]>(async () => treeNodes),
    readTraceEvents: vi.fn<TraceApi["readTraceEvents"]>(async () => [
      { spanId: "reader-span", timestamp: 1, name: "step", attributes: { said: "hello" } },
      {
        spanId: "owner-span",
        timestamp: 2,
        name: "step",
        attributes: { said: "secret" },
        ownerProjectId: OWNER,
      },
    ]),
    readSpanResources: vi.fn<TraceApi["readSpanResources"]>(async () => [
      {
        spanId: "owner-span",
        parentSpanId: null,
        startTimeMs: 0,
        resourceAttributes: { "service.name": "owner-service" },
        scopeName: "test",
        scopeVersion: null,
        ownerProjectId: OWNER,
      },
      {
        spanId: "reader-span",
        parentSpanId: null,
        startTimeMs: 1,
        resourceAttributes: { "service.name": "reader-service" },
        scopeName: "test",
        scopeVersion: null,
      },
    ]),
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

const trace = { projectId: READER, traceId: "trace-1" };

describe("the drawer's views of a braided trace", () => {
  describe("when the timeline shows a braided span's events", () => {
    /** @scenario "Every view of the trace shows the same braided spans" */
    it("reads spans and hides the owner's event content under the owner's policy only", async () => {
      const { app, caller } = mount();

      const events = await caller.traceEvents(trace);

      expect(app.readTraceEvents).toHaveBeenCalledWith(expect.objectContaining({ reads: "spans" }));
      expect(events.map((event) => [event.spanId, event.attributes.said])).toEqual([
        ["reader-span", "hello"],
        ["owner-span", "[REDACTED]"],
      ]);
    });
  });

  describe("when the span tree prices a braided span", () => {
    /** @scenario "A braided span's cost shows only to a viewer who may see costs on its owner" */
    it("hides the owner's span cost when the viewer may not see costs there", async () => {
      const { caller } = mount();

      const page = await caller.spanTreePaginated({ ...trace, limit: 50 });
      const delta = await caller.spanTreeDelta({ ...trace, sinceUpdatedAtMs: 0 });

      for (const nodes of [page.nodes, delta]) {
        expect(nodes.map((node) => [node.spanId, node.cost])).toEqual([
          ["reader-span", 0.5],
          ["owner-span", null],
        ]);
      }
    });

    it("shows the owner's span cost by the owner's standing, not the reader's", async () => {
      const { caller } = mount({
        reader: { ...readerSees, canSeeCosts: false },
        owner: { ...ownerHides, canSeeCosts: true },
      });

      const page = await caller.spanTreePaginated({ ...trace, limit: 50 });

      expect(page.nodes.map((node) => [node.spanId, node.cost])).toEqual([
        ["reader-span", null],
        ["owner-span", 0.25],
      ]);
    });
  });

  describe("when the resource pane shows a braided span", () => {
    it("takes the trace's resources from the reader's span and gates the owner's by its owner", async () => {
      const { app, caller } = mount();

      const resources = await caller.resourceInfo(trace);

      expect(app.readSpanResources).toHaveBeenCalledWith(
        expect.objectContaining({ reads: "spans" }),
      );
      expect(resources.rootSpanId).toBe("reader-span");
      expect(resources.resourceAttributes["service.name"]).toBe("reader-service");
      const owned = resources.spans.find((span) => span.ownerProjectId === OWNER);
      expect(owned?.resourceAttributes["service.name"]).not.toBe("owner-service");
    });
  });
});
