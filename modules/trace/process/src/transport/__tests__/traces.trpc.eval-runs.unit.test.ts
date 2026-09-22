/**
 * @vitest-environment node
 * The Explorer's four reads and the Instant Eval runs their chips claim.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { ResolvedInstantEvalRun, TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000 };
const CHIP_KEY = "chip-1";
const CLAIMED = { question: "the user is annoyed", target: "traces", runId: "run-1" } as const;
const RESOLVED: ResolvedInstantEvalRun = {
  ...CLAIMED,
  writtenFrom: 900,
  writtenUntil: 2_100,
};
const COMPILED = { sql: "1 = 1", params: {} };
const FACET_COUNTS = {
  origin: {},
  status: {},
  service: {},
  model: {},
  ranges: {
    tokens: { min: 0, max: 0 },
    cost: { min: 0, max: 0 },
    latency: { min: 0, max: 0 },
  },
};

function harness() {
  const findExplorerEvalRuns = vi.fn<TraceApi["findExplorerEvalRuns"]>(async () => [RESOLVED]);
  const compileExplorerTraceFilter = vi.fn<TraceApi["compileExplorerTraceFilter"]>(() => COMPILED);
  const translateTraceFilter = vi.fn<TraceApi["translateTraceFilter"]>(() => COMPILED);
  const app = createApiFixture<TraceApi>({
    findExplorerEvalRuns,
    compileExplorerTraceFilter,
    translateTraceFilter,
    resolveViewerProtections: async () => ({}),
    extractTraceFreeTextTerms: () => [],
    readTraceList: async () => ({ items: [], totalHits: 0, evaluations: {}, nextCursor: null }),
    readSessionGroups: async () => ({ sessions: [], totalHits: 0, nextCursor: null }),
    readFacets: async () => FACET_COUNTS,
    readNewCount: async () => 3,
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
    compileExplorerTraceFilter,
    findExplorerEvalRuns,
    translateTraceFilter,
  };
}

const claim = { [CHIP_KEY]: CLAIMED };

describe("given a read whose query carries an eval chip with a registered run", () => {
  describe("when the table reads a page", () => {
    /** @scenario "Every explorer read checks the runs its chips claim" */
    it("checks the claim against the project, then compiles with the dated run", async () => {
      const { caller, compileExplorerTraceFilter, findExplorerEvalRuns } = harness();

      await caller.list({
        projectId: PROJECT_ID,
        timeRange: TIME_RANGE,
        sort: { columnId: "startedAt", direction: "desc" },
        query: 'eval:"the user is annoyed"',
        evalRuns: claim,
      });

      expect(findExplorerEvalRuns).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        evalRuns: claim,
      });
      expect(compileExplorerTraceFilter).toHaveBeenCalledWith(
        expect.objectContaining({ evalRuns: [RESOLVED] }),
      );
    });
  });

  describe("when the sessions lens reads a page", () => {
    it("compiles with the dated run", async () => {
      const { caller, compileExplorerTraceFilter } = harness();

      await caller.sessions({
        projectId: PROJECT_ID,
        timeRange: TIME_RANGE,
        query: 'eval:"the user is annoyed"',
        evalRuns: claim,
      });

      expect(compileExplorerTraceFilter).toHaveBeenCalledWith(
        expect.objectContaining({ evalRuns: [RESOLVED] }),
      );
    });
  });

  describe("when the sidebar reads its facet counts", () => {
    it("counts over the same runs, so a chip does not empty the sidebar", async () => {
      const { caller, translateTraceFilter } = harness();

      await expect(
        caller.facets({
          projectId: PROJECT_ID,
          timeRange: TIME_RANGE,
          query: 'eval:"the user is annoyed"',
          evalRuns: claim,
        }),
      ).resolves.toEqual(FACET_COUNTS);
      expect(translateTraceFilter).toHaveBeenCalledWith(
        expect.objectContaining({ evalRuns: [RESOLVED] }),
      );
    });
  });

  describe("when the table asks what has arrived since", () => {
    it("counts over the same runs", async () => {
      const { caller, compileExplorerTraceFilter } = harness();

      await expect(
        caller.newCount({
          projectId: PROJECT_ID,
          timeRange: TIME_RANGE,
          since: 1_500,
          query: 'eval:"the user is annoyed"',
          evalRuns: claim,
        }),
      ).resolves.toEqual({ count: 3 });
      expect(compileExplorerTraceFilter).toHaveBeenCalledWith(
        expect.objectContaining({ evalRuns: [RESOLVED] }),
      );
    });
  });
});

describe("given a read whose chips claim no run", () => {
  describe("when the table reads a page", () => {
    it("compiles with no runs, leaving the chip pending", async () => {
      const { caller, findExplorerEvalRuns } = harness();
      findExplorerEvalRuns.mockResolvedValue([]);

      await caller.list({
        projectId: PROJECT_ID,
        timeRange: TIME_RANGE,
        sort: { columnId: "startedAt", direction: "desc" },
        query: 'eval:"the user is annoyed"',
      });

      expect(findExplorerEvalRuns).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        evalRuns: undefined,
      });
    });
  });
});
