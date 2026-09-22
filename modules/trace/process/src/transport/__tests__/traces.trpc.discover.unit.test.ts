/**
 * @vitest-environment node
 * The sidebar's one facet read: the cached discovery while no query is active,
 * the filtered counts as soon as one is.
 * @see specs/traces-v2/search.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000, live: true };
const FACET = {
  key: "status",
  kind: "categorical" as const,
  label: "Status",
  group: "trace" as const,
  topValues: [{ value: "error", count: 4 }],
  totalDistinct: 1,
};

function harness() {
  const readDiscover = vi.fn<TraceApi["readDiscover"]>(async () => ({
    facets: [FACET],
    pending: true,
  }));
  const readFilteredFacets = vi.fn<TraceApi["readFilteredFacets"]>(async () => ({
    facets: [FACET],
    pending: false,
  }));
  const findExplorerEvalRuns = vi.fn<TraceApi["findExplorerEvalRuns"]>(async () => []);
  const app = createApiFixture<TraceApi>({
    readDiscover,
    readFilteredFacets,
    findExplorerEvalRuns,
  });

  const trpc = initTRPC.context<TestContext>().create();
  const members: TrpcRuntimeMembers<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(tracesTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "reader-1" } }),
    readDiscover,
    readFilteredFacets,
  };
}

describe("given no query", () => {
  describe("when the sidebar reads its facets", () => {
    it("serves the tenant's cached discovery, pending flag and all", async () => {
      const { caller, readDiscover, readFilteredFacets } = harness();

      await expect(
        caller.discover({ projectId: PROJECT_ID, timeRange: TIME_RANGE }),
      ).resolves.toEqual({ facets: [FACET], pending: true });
      expect(readDiscover).toHaveBeenCalledWith({
        tenantId: PROJECT_ID,
        timeRange: TIME_RANGE,
      });
      expect(readFilteredFacets).not.toHaveBeenCalled();
    });
  });
});

describe("given an empty query the sidebar asked to count under", () => {
  describe("when the sidebar reads its facets", () => {
    it("counts, so the hidden origins stay out of every facet but Origin", async () => {
      const { caller, readDiscover, readFilteredFacets } = harness();

      await caller.discover({ projectId: PROJECT_ID, timeRange: TIME_RANGE, query: "" });

      expect(readFilteredFacets).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
      expect(readDiscover).not.toHaveBeenCalled();
    });
  });
});

describe("given an active query", () => {
  describe("when the sidebar reads its facets", () => {
    /** @scenario "Facet counts are cached only per query and window" */
    it("counts under it, in the window the list reads, uncached", async () => {
      const { caller, readDiscover, readFilteredFacets } = harness();

      await expect(
        caller.discover({
          projectId: PROJECT_ID,
          timeRange: TIME_RANGE,
          query: "status:error",
        }),
      ).resolves.toEqual({ facets: [FACET], pending: false });
      expect(readFilteredFacets).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          timeRange: TIME_RANGE,
          query: "status:error",
        }),
      );
      expect(readDiscover).not.toHaveBeenCalled();
    });
  });
});
