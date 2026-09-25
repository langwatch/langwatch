/**
 * @vitest-environment node
 * The Explorer's Instant Eval served under main's nested `traces.instantEval.*` wire.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import {
  type ExplorerInstantEvalProgress,
  type TraceApi,
  tracesInstantEvalTrpc,
} from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesInstantEvalTrpcTransport } from "../traces-instant-eval.trpc.ts";

type TestContext = { actor: { id: string } };

const RUN = { projectId: "project-1", runId: "run-1" };
const PROGRESS: ExplorerInstantEvalProgress = {
  id: "run-1",
  status: "running",
  total: 10,
  progress: 4,
  matched: 2,
  failed: 0,
  skipped: 0,
  error: null,
  priceUsd: 0.01,
  finishedAtMs: null,
};

function harness() {
  const getExplorerEvalRun = vi.fn<TraceApi["getExplorerEvalRun"]>(async () => PROGRESS);
  const cancelExplorerEvalRun = vi.fn<TraceApi["cancelExplorerEvalRun"]>(async () => PROGRESS);
  const app = createApiFixture<TraceApi>({ getExplorerEvalRun, cancelExplorerEvalRun });
  const permissions: string[] = [];
  const trpc = initTRPC.context<TestContext>().create();
  const members: TrpcRuntimeMembers<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => {
          permissions.push(permission);
          return { permitted: true, organizationRole: null };
        },
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
  }).mount(tracesInstantEvalTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "reader-1" } }),
    cancelExplorerEvalRun,
    getExplorerEvalRun,
    permissions,
  };
}

describe("given the traces.instantEval tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares main's four nested procedures", () => {
      expect(
        Object.entries(tracesInstantEvalTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["estimate", "mutation"],
        ["start", "mutation"],
        ["cancel", "mutation"],
        ["get", "query"],
      ]);
    });

    it("carries the nested namespace on both halves", () => {
      expect([tracesInstantEvalTrpc.namespace, tracesInstantEvalTrpcTransport.namespace]).toEqual([
        "traces.instantEval",
        "traces.instantEval",
      ]);
    });
  });
});

describe("given the traces.instantEval router", () => {
  describe("when a run is read back", () => {
    it("reads it for the project under analytics:view", async () => {
      const { caller, getExplorerEvalRun, permissions } = harness();

      await expect(caller.get(RUN)).resolves.toEqual(PROGRESS);
      expect(getExplorerEvalRun).toHaveBeenCalledWith(RUN);
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when a run is cancelled", () => {
    it("names the caller as the requester under analytics:manage", async () => {
      const { caller, cancelExplorerEvalRun, permissions } = harness();

      await caller.cancel(RUN);

      expect(cancelExplorerEvalRun).toHaveBeenCalledWith({ ...RUN, requestedByUserId: "reader-1" });
      expect(permissions).toEqual(["analytics:manage"]);
    });
  });
});
