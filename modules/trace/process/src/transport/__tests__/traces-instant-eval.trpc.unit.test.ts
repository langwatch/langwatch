import { createTrpcRuntime } from "@langwatch/api/trpc";
import { InstantEvalClassifierNotConfiguredError } from "@langwatch/instant-eval-contract";
/**
 * @vitest-environment node
 * The Explorer's Instant Eval served under main's nested `traces.instantEval.*` wire.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
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
  // A released project on a deployment with no judge, refused by the run service.
  const estimateExplorerEvalRun = vi.fn<TraceApi["estimateExplorerEvalRun"]>(async () => {
    throw new InstantEvalClassifierNotConfiguredError();
  });
  const readExplorerEvalAccess = vi.fn<TraceApi["readExplorerEvalAccess"]>(async () => ({
    released: false,
    offer: "ask_admin" as const,
  }));
  const enableExplorerEvals = vi.fn<TraceApi["enableExplorerEvals"]>(async () => ({
    released: true,
    offer: "enable" as const,
  }));
  const app = createApiFixture<TraceApi>({
    getExplorerEvalRun,
    cancelExplorerEvalRun,
    estimateExplorerEvalRun,
    readExplorerEvalAccess,
    enableExplorerEvals,
  });
  const permissions: string[] = [];
  const trpc = initTRPC.context<TestContext>().create();
  const members = trpcTestMembers<TestContext>({
    permits: (permission) => {
      permissions.push(permission);

      return true;
    },
  });
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(tracesInstantEvalTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "reader-1" } }),
    cancelExplorerEvalRun,
    getExplorerEvalRun,
    readExplorerEvalAccess,
    enableExplorerEvals,
    permissions,
  };
}

describe("given the traces.instantEval tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares main's six nested procedures", () => {
      expect(
        Object.entries(tracesInstantEvalTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["access", "query"],
        ["enable", "mutation"],
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
  describe("when the popover asks what to offer", () => {
    it("reads the access for the caller under analytics:view", async () => {
      const { caller, readExplorerEvalAccess, permissions } = harness();

      await expect(caller.access({ projectId: "project-1" })).resolves.toEqual({
        released: false,
        offer: "ask_admin",
      });
      expect(readExplorerEvalAccess).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "reader-1",
      });
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when a member throws the organization's switch", () => {
    it("takes organization:manage, never the project's spend permission", async () => {
      const { caller, enableExplorerEvals, permissions } = harness();

      await expect(caller.enable({ projectId: "project-1" })).resolves.toEqual({
        released: true,
        offer: "enable",
      });
      expect(enableExplorerEvals).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "reader-1",
      });
      expect(permissions).toEqual(["organization:manage"]);
    });
  });

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

  describe("when the deployment has no judge for a released project", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("refuses the estimate with the handled code the Explorer's popover reads", async () => {
      const { caller } = harness();

      await expect(
        caller.estimate({
          projectId: "project-1",
          target: "traces",
          filter: "",
          window: { from: 1_000, to: 2_000 },
          question: { instructions: "the user is annoyed" },
        }),
      ).rejects.toMatchObject({
        cause: { code: "instant_eval_classifier_not_configured", httpStatus: 403 },
      });
    });
  });
});
