import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The download door's page size: with spans it names none, so the app answers the spans bound.
 * @see specs/traces/trace-list-page-size-cap.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const DOWNLOAD = { projectId: "project-1", startDate: 1000, endDate: 5000, filters: {} };

function harness() {
  const listTraces = vi.fn<TraceApi["listTraces"]>(async () => ({
    groups: [],
    totalHits: 0,
    traceChecks: {},
  }));
  const app = createApiFixture<TraceApi>({
    resolveViewerProtections: vi.fn<TraceApi["resolveViewerProtections"]>(async () => ({})),
    listTraces,
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(tracesTrpcTransport, () => app);
  const pageSizeAsked = () => listTraces.mock.calls[0]?.[0]?.query.pageSize;
  return { caller: router.createCaller({ actor: { id: "reader-1" } }), pageSizeAsked };
}

describe("traces.getAllForDownload", () => {
  describe("when a download asks for spans and names no pageSize", () => {
    /** @scenario "Every trace read with spans is held to the spans page bound" */
    it("names no page size, so the app answers pages at the spans bound", async () => {
      const { caller, pageSizeAsked } = harness();
      await caller.getAllForDownload({ ...DOWNLOAD, includeSpans: true });
      expect(pageSizeAsked()).toBeUndefined();
    });
  });

  describe("when a download without spans names no pageSize", () => {
    /** @scenario "Every trace read with spans is held to the spans page bound" */
    it("asks for pages of 10 000", async () => {
      const { caller, pageSizeAsked } = harness();
      await caller.getAllForDownload({ ...DOWNLOAD, includeSpans: false });
      expect(pageSizeAsked()).toBe(10_000);
    });
  });
});
