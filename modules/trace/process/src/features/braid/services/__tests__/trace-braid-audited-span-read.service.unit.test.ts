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
import { MemoryNullTraceBraidReadsRepository } from "../../repositories/memory/memory.null-trace-braid-reads.repository.ts";
import {
  TRACE_BRAID_READS,
  TRACE_SPAN_READS,
  TraceBraidAuditedSpanReadService,
  type TraceBraidRead,
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
  getSpansPaginated: { spans: [ownRow, ownerRow], total: 2, totalOwnerProjectIds: [] },
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
    braids: Object.assign(MemoryNullTraceBraidReadsRepository.create(), {
      sumSpansInTrace: async () => [totalsOf(READER), totalsOf(OWNER)],
      countReaderBraidActivity: async () => new Map([[BRAID_ID, 3]]),
    }),
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

const BRAID_ID = "braid-1";

function totalsOf(tenantId: string) {
  return {
    tenantId,
    spanCount: 2,
    startMs: 0,
    endMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    explicitCost: 0,
    costInput: null,
  };
}

/** The reads under the reader's braided proof, showing totals or counts of an owner's spans. */
const SHOWING_AN_OWNERS_TOTALS = ["sumSpansInTrace", "countReaderBraidActivity"] as const;

function braidParams(authorization: ReturnType<typeof braidedProof>) {
  return {
    authorization,
    traceId: "trace-1",
    sinceMs: 0,
    braids: [
      {
        braidId: BRAID_ID,
        ownerProjectId: OWNER,
        readerProjectId: READER,
        compiledWhere: undefined,
        fromMs: 0,
        untilMs: 1,
      },
    ],
  };
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

  describe("when a page past the last span returns a total counting an owner's spans", () => {
    const pastTheEnd = { spans: [ownRow], total: 6, totalOwnerProjectIds: [OWNER] };

    /** @scenario "A page's total counting an owner's spans is audited, even with none of them shown" */
    it("records the braided spans viewed entry naming the owner before it returns", async () => {
      const { read, recordView, authorization } = doorOver({
        results: { ...SHOWING_AN_OWNER, getSpansPaginated: pastTheEnd },
      });

      await expect(read("getSpansPaginated")).resolves.toMatchObject({ total: 6 });

      expect(recordView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "A page's total counting an owner's spans is audited, even with none of them shown" */
    it("refuses rather than return the total when the entry cannot be written", async () => {
      const { read, recordView } = doorOver({
        results: { ...SHOWING_AN_OWNER, getSpansPaginated: pastTheEnd },
      });
      recordView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(read("getSpansPaginated")).rejects.toThrow("audit store unreachable");
    });
  });

  it("names how every braid read's owners are read", () => {
    expect(TRACE_BRAID_READS.toSorted()).toEqual(
      Object.getOwnPropertyNames(
        Object.getPrototypeOf(MemoryNullTraceBraidReadsRepository.create()),
      )
        .filter((name) => name !== "constructor")
        .toSorted(),
    );
  });

  describe.each(SHOWING_AN_OWNERS_TOTALS)("when %s returns an owner's totals", (method) => {
    const readBraid = (
      door: TraceBraidAuditedSpanReadService,
      authorization: ReturnType<typeof braidedProof>,
    ) =>
      (door.braidReads[method] as (params: unknown) => Promise<unknown>)(
        braidParams(authorization),
      );

    /** @scenario "A span read that skips the audit door cannot be written" */
    it("records one braided spans viewed entry naming the owner before it returns", async () => {
      const { door, recordView, authorization } = doorOver({ results: SHOWING_AN_OWNER });

      await readBraid(door, authorization);

      expect(recordView).toHaveBeenCalledTimes(1);
      expect(recordView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "A span read that skips the audit door cannot be written" */
    it("refuses rather than return the totals when the entry cannot be written", async () => {
      const { door, recordView, authorization } = doorOver({ results: SHOWING_AN_OWNER });
      recordView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(readBraid(door, authorization)).rejects.toThrow("audit store unreachable");
    });
  });

  describe.each(
    TRACE_BRAID_READS.filter(
      (method): method is Exclude<TraceBraidRead, (typeof SHOWING_AN_OWNERS_TOTALS)[number]> =>
        !(SHOWING_AN_OWNERS_TOTALS as readonly string[]).includes(method),
    ),
  )("when %s reads a resource no braid opens", (method) => {
    it("records nothing", async () => {
      const { door, recordView, authorization } = doorOver({ results: SHOWING_AN_OWNER });

      await (door.braidReads[method] as (params: unknown) => Promise<unknown>)({
        ...braidParams(authorization),
        traceIds: [],
        limit: 1,
        excludedPrefix: "langwatch.",
        live: [],
        draft: braidParams(authorization).braids[0],
      });

      expect(recordView).not.toHaveBeenCalled();
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
