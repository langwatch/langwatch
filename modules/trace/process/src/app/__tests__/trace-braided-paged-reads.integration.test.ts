/**
 * The paged and live span reads of a braided trace (ADR-201 §8): each records the braided spans
 * viewed entry before it returns an owner's span, and fails when the entry cannot be written.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { baseSpanSchema, type SpanTreeNode } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { braidedProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceService } from "../../services/trace.service.ts";
import type { TracesSpanReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";

function spanOf(spanId: string, ownerProjectId?: string) {
  const span = baseSpanSchema.parse({
    span_id: spanId,
    trace_id: "trace-1",
    type: "span",
    timestamps: { started_at: 1_700_000_000_000, finished_at: 1_700_000_000_010 },
  });
  return ownerProjectId === undefined ? span : { ...span, ownerProjectId };
}

function nodeOf(spanId: string, ownerProjectId?: string): SpanTreeNode {
  return {
    spanId,
    parentSpanId: null,
    name: "step",
    type: "llm",
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok",
    model: null,
    cost: null,
    ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
  };
}

function braidedTrace({ withOwnerSpans = true } = {}) {
  const owner = withOwnerSpans ? OWNER : undefined;
  const spans = [spanOf("reader-span"), spanOf("owner-span", owner)];
  const nodes = [nodeOf("reader-span"), nodeOf("owner-span", owner)];
  const recordBraidedSpansView = vi.fn<AuthzApi["recordBraidedSpansView"]>(async () => undefined);
  const app = createTraceAppHarness({
    braidDirectory: {
      authz: createApiFixture<AuthzApi>({ recordBraidedSpansView }, "braidAuthz"),
      projects: createApiFixture<ProjectApi>({}, "braidProjects"),
    },
    traces: {
      spans: createApiFixture<TracesSpanReader>(
        {
          getSpansPaginated: async () => ({ spans, total: spans.length, totalOwnerProjectIds: [] }),
          getSpansSince: async () => spans,
        },
        "spans",
      ),
      tree: createApiFixture<TraceService>({ getSpanTreeDelta: async () => nodes }, "tree"),
    },
  });
  const authorization = braidedProof({ projectId: READER, braids: [{ owner: OWNER }] });
  const reads = {
    spansPage: () =>
      app.readSpansPage({
        authorization,
        traceId: "trace-1",
        limit: 50,
        offset: 0,
        reads: "spans",
      }),
    spansSince: () =>
      app.readSpansSince({
        authorization,
        traceId: "trace-1",
        sinceStartTimeMs: 0,
        reads: "spans",
      }),
    treeDelta: () =>
      app.readSpanTreeDelta({
        authorization,
        projectId: READER,
        traceId: "trace-1",
        sinceUpdatedAtMs: 0,
        canSeeCosts: true,
      }),
  };
  return { reads, recordBraidedSpansView, authorization };
}

const READS = ["spansPage", "spansSince", "treeDelta"] as const;

describe("the paged and live span reads of a braided trace", () => {
  describe.each(READS)("when %s returns an owner's span", (read) => {
    /** @scenario "Paged and live span reads with braided spans are audited, or refused" */
    it("records the braided spans viewed entry, naming the reader and the owner", async () => {
      const { reads, recordBraidedSpansView, authorization } = braidedTrace();

      await reads[read]();

      expect(recordBraidedSpansView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "Paged and live span reads with braided spans are audited, or refused" */
    it("fails rather than return the owner's span when the entry cannot be written", async () => {
      const { reads, recordBraidedSpansView } = braidedTrace();
      recordBraidedSpansView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(reads[read]()).rejects.toThrow("audit store unreachable");
    });
  });

  describe.each(READS)("when %s returns only the reader's own spans", (read) => {
    it("records nothing", async () => {
      const { reads, recordBraidedSpansView } = braidedTrace({ withOwnerSpans: false });

      await reads[read]();

      expect(recordBraidedSpansView).not.toHaveBeenCalled();
    });
  });
});
