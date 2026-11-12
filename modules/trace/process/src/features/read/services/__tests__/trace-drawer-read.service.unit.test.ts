/**
 * @see modules/trace/specs/braided-spans.feature
 * The drawer's views of a braided trace (ADR-201 §5): each reads `spans`, and each braided item is
 * protected by its owner's protections, the reader's by theirs.
 */
import type { Authorization } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Protections, SpanTreeNode, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { EmptyTraceBraidReadsRepository } from "../../../../repositories/trace-braid-reads.repository.ts";
import { traceReadMapperPorts } from "../../../../rules/trace-read-mapper-ports.rules.ts";
import { TraceBraidDetailService } from "../trace-braid-detail.service.ts";
import { TraceBraidedTotalsService } from "../trace-braided-totals.service.ts";
import { TraceDrawerReadService } from "../trace-drawer-read.service.ts";

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

function drawer({ reader = readerSees, owner = ownerHides } = {}) {
  const reads = {
    authorizationForTrace: vi.fn(
      async ({ authorization }: { authorization: Authorization }) => authorization,
    ),
    resolveViewerProtections: vi.fn<TraceApi["resolveViewerProtections"]>(async ({ projectId }) =>
      projectId === OWNER ? owner : reader,
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
  const service = TraceDrawerReadService.create({
    reads: createApiFixture<Parameters<typeof TraceDrawerReadService.create>[0]["reads"]>(
      reads,
      "reads",
    ),
    braids: TraceBraidDetailService.create({
      directory: {
        authz: createApiFixture<AuthzApi>({}, "authz"),
        projects: createApiFixture<ProjectApi>({}, "projects"),
      },
    }),
    totals: TraceBraidedTotalsService.create({
      reads: EmptyTraceBraidReadsRepository.create(),
      prices: null,
    }),
    mappers: traceReadMapperPorts,
  });
  const view = {
    projectId: READER,
    authorization: ownProof({ projectId: READER }),
    traceId: "trace-1",
    viewerUserId: "user_ana",
  };
  return { reads, service, view };
}

describe("the drawer's views of a braided trace", () => {
  describe("when the timeline shows a braided span's events", () => {
    /** @scenario "Every view of the trace shows the same braided spans" */
    it("reads spans and hides the owner's event content under the owner's policy only", async () => {
      const { reads, service, view } = drawer();

      const events = await service.traceEvents(view);

      expect(reads.readTraceEvents).toHaveBeenCalledWith(
        expect.objectContaining({ reads: "spans" }),
      );
      expect(events.map((event) => [event.spanId, event.attributes.said])).toEqual([
        ["reader-span", "hello"],
        ["owner-span", "[REDACTED]"],
      ]);
    });
  });

  describe("when the span tree prices a braided span", () => {
    /** @scenario "A braided span's cost shows only to a viewer who may see costs on its owner" */
    it("hides the owner's span cost when the viewer may not see costs there", async () => {
      const { service, view } = drawer();

      const page = await service.spanTreePage({ ...view, limit: 50 });
      const delta = await service.spanTreeDelta({ ...view, sinceUpdatedAtMs: 0 });

      for (const nodes of [page.nodes, delta]) {
        expect(nodes.map((node) => [node.spanId, node.cost])).toEqual([
          ["reader-span", 0.5],
          ["owner-span", null],
        ]);
      }
    });

    it("shows the owner's span cost by the owner's standing, not the reader's", async () => {
      const { service, view } = drawer({
        reader: { ...readerSees, canSeeCosts: false },
        owner: { ...ownerHides, canSeeCosts: true },
      });

      const page = await service.spanTreePage({ ...view, limit: 50 });

      expect(page.nodes.map((node) => [node.spanId, node.cost])).toEqual([
        ["reader-span", null],
        ["owner-span", 0.25],
      ]);
    });

    it("prices the tree in full and gates each span afterwards", async () => {
      const { reads, service, view } = drawer();

      await service.spanTreePage({ ...view, limit: 50 });

      expect(reads.readSpanTreePage).toHaveBeenCalledWith(
        expect.objectContaining({ canSeeCosts: true, traceId: "trace-1" }),
      );
    });
  });

  describe("when the resource pane shows a braided span", () => {
    it("takes the trace's resources from the reader's span and gates the owner's by its owner", async () => {
      const { reads, service, view } = drawer();

      const resources = await service.resources(view);

      expect(reads.readSpanResources).toHaveBeenCalledWith(
        expect.objectContaining({ reads: "spans" }),
      );
      expect(resources.rootSpanId).toBe("reader-span");
      expect(resources.resourceAttributes["service.name"]).toBe("reader-service");
      const owned = resources.spans.find((span) => span.ownerProjectId === OWNER);
      expect(owned?.resourceAttributes["service.name"]).not.toBe("owner-service");
    });
  });

  describe("when a view opens the trace", () => {
    it("reads under the proof narrowed to the trace's member", async () => {
      const { reads, service, view } = drawer();
      const narrowed = ownProof({ projectId: "project_member" });
      reads.authorizationForTrace.mockResolvedValueOnce(narrowed);

      await service.traceEvents({ ...view, tenantId: "project_member" });

      expect(reads.authorizationForTrace).toHaveBeenCalledWith({
        authorization: view.authorization,
        traceId: "trace-1",
        tenantId: "project_member",
      });
      expect(reads.readTraceEvents).toHaveBeenCalledWith(
        expect.objectContaining({ authorization: narrowed }),
      );
    });
  });
});
