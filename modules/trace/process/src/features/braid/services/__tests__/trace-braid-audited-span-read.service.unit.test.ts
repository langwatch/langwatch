/**
 * The one door the trace module's span reads pass through (ADR-201 §8, v1.10): every read the
 * span store answers returns an owner's row only after the audit is written.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { TracesSpanReader } from "#app/trace.app";

import { braidedProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceBraidDetailService } from "../../../read/services/trace-braid-detail.service.ts";
import {
  TRACE_SPAN_READS,
  TraceBraidAuditedSpanReadService,
  type TraceSpanRead,
  type TraceSpanTreeReads,
} from "../trace-braid-audited-span-read.service.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const ownerRow = { spanId: "owner-span", ownerProjectId: OWNER };
const ownRow = { spanId: "reader-span" };

/** What each span read returns showing an owner's row; a read missing here fails the build. */
const SHOWING_AN_OWNER = {
  getSpansByTraceId: [ownRow, ownerRow],
  getNormalizedSpansByTraceId: [ownRow, ownerRow],
  findStoredSpansByTraceId: [ownRow, ownerRow],
  findSpanById: ownRow,
  getSpanEvents: [{ event_id: "event-1" }],
  getSpansPaginated: { spans: [ownRow, ownerRow], total: 2 },
  getSpansSince: [ownRow, ownerRow],
  getSpanSummaryByTraceId: [ownRow, ownerRow],
  getLangwatchSignalsByTraceId: [ownRow, ownerRow],
  getSpanResourcesByTraceId: [ownRow, ownerRow],
  getTraceEventsByTraceId: [ownRow, ownerRow],
  getTraceEventRollupsByTraceIds: { "trace-1": ownerRow },
  getModelUsageStats: [ownerRow],
  getRecentSpansByModels: [ownerRow],
} satisfies Record<TraceSpanRead, unknown>;

function doorOver({ results }: { results: Readonly<Record<string, unknown>> }) {
  const reader = Object.fromEntries(
    Object.entries(results).map(([method, result]) => [method, async () => result]),
  );
  const recordView = vi.fn<AuthzApi["recordBraidedSpansView"]>(async () => undefined);
  const door = TraceBraidAuditedSpanReadService.create({
    spans: createApiFixture<TracesSpanReader>(reader as Partial<TracesSpanReader>, "spans"),
    tree: createApiFixture<TraceSpanTreeReads>(
      {
        getSpanTreePage: async () => ({ nodes: [treeNode(OWNER)], nextCursor: null }),
        getSpanTreeDelta: async () => [treeNode(OWNER)],
      },
      "tree",
    ),
    audit: TraceBraidDetailService.create({
      directory: {
        authz: createApiFixture<AuthzApi>({ recordBraidedSpansView: recordView }, "braidAuthz"),
        projects: createApiFixture<ProjectApi>({}, "braidProjects"),
      },
    }),
  });
  const authorization = braidedProof({ projectId: READER, braids: [{ owner: OWNER }] });
  // Every read's params, as one: by id reads name the owner, the rest ignore what they do not take.
  const params = { authorization, traceId: "trace-1", spanId: "owner-span", ownerProjectId: OWNER };
  const read = (method: TraceSpanRead) =>
    door.read(method, params as Parameters<TracesSpanReader[typeof method]>[0]);
  return { door, read, recordView, authorization, params };
}

function treeNode(ownerProjectId?: string) {
  return {
    spanId: "node",
    parentSpanId: null,
    name: "step",
    type: "llm",
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok" as const,
    model: null,
    cost: null,
    ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
  };
}

const treeInput = {
  projectId: READER,
  traceId: "trace-1",
  canSeeCosts: true,
  limit: 50,
  sinceUpdatedAtMs: 0,
};

describe("TraceBraidAuditedSpanReadService", () => {
  it("covers every read the span store answers", () => {
    expect(TRACE_SPAN_READS.toSorted()).toEqual(Object.keys(SHOWING_AN_OWNER).toSorted());
  });

  describe.each(TRACE_SPAN_READS)("when %s returns an owner's row", (method) => {
    /** @scenario "A span read that skips the audit door cannot be written" */
    it("records one braided spans viewed entry naming the owner before it returns", async () => {
      const { read, recordView, authorization } = doorOver({ results: SHOWING_AN_OWNER });

      await read(method);

      expect(recordView).toHaveBeenCalledTimes(1);
      expect(recordView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "A span read that skips the audit door cannot be written" */
    it("refuses rather than return the owner's row when the entry cannot be written", async () => {
      const { read, recordView } = doorOver({ results: SHOWING_AN_OWNER });
      recordView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(read(method)).rejects.toThrow("audit store unreachable");
    });
  });

  describe("when a read returns only the reader's own rows", () => {
    it("records nothing", async () => {
      const { door, recordView, authorization } = doorOver({
        results: { getSpansByTraceId: [ownRow] },
      });

      await door.read("getSpansByTraceId", { authorization, traceId: "trace-1" });

      expect(recordView).not.toHaveBeenCalled();
    });
  });

  describe("when a read by owner and id finds nothing", () => {
    it("records nothing", async () => {
      const { door, recordView, params } = doorOver({ results: { findSpanById: null } });

      await door.read("findSpanById", params);

      expect(recordView).not.toHaveBeenCalled();
    });
  });

  describe("when the span panel reads an owner's span with its events", () => {
    it("audits once for both", async () => {
      const { door, recordView, params } = doorOver({ results: SHOWING_AN_OWNER });

      await door.readSpanWithEvents(params);

      expect(recordView).toHaveBeenCalledTimes(1);
      expect(recordView).toHaveBeenCalledWith(
        expect.objectContaining({ ownerProjectIds: [OWNER] }),
      );
    });

    it("refuses when the entry cannot be written", async () => {
      const { door, recordView, params } = doorOver({ results: SHOWING_AN_OWNER });
      recordView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(door.readSpanWithEvents(params)).rejects.toThrow("audit store unreachable");
    });

    it("audits the owner's events even when the span itself is not found", async () => {
      const { door, recordView, params } = doorOver({
        results: { findSpanById: null, getSpanEvents: SHOWING_AN_OWNER.getSpanEvents },
      });

      await door.readSpanWithEvents(params);

      expect(recordView).toHaveBeenCalledWith(
        expect.objectContaining({ ownerProjectIds: [OWNER] }),
      );
    });
  });

  describe.each(["readSpanTreePage", "readSpanTreeDelta"] as const)(
    "when %s returns an owner's node",
    (method) => {
      /** @scenario "A span read that skips the audit door cannot be written" */
      it("refuses rather than return it when the entry cannot be written", async () => {
        const { door, recordView, authorization } = doorOver({ results: SHOWING_AN_OWNER });
        recordView.mockRejectedValueOnce(new Error("audit store unreachable"));

        await expect(door[method]({ ...treeInput, authorization })).rejects.toThrow(
          "audit store unreachable",
        );
      });
    },
  );
});
