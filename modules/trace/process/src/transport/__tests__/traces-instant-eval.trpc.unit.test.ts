import { createTrpcRuntime, type TrpcRuntimeAuditEntry } from "@langwatch/api/trpc";
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

const OFFERED = { released: false, offer: "enable" } as const;

function harness({ permitted = () => true }: { permitted?: (permission: string) => boolean } = {}) {
  const getExplorerEvalRun = vi.fn<TraceApi["getExplorerEvalRun"]>(async () => PROGRESS);
  const cancelExplorerEvalRun = vi.fn<TraceApi["cancelExplorerEvalRun"]>(async () => PROGRESS);
  // A released project on a deployment with no judge, refused by the run service.
  const estimateExplorerEvalRun = vi.fn<TraceApi["estimateExplorerEvalRun"]>(async () => {
    throw new InstantEvalClassifierNotConfiguredError();
  });
  const getExplorerEvalAccess = vi.fn<TraceApi["getExplorerEvalAccess"]>(async () => OFFERED);
  const enableExplorerEvals = vi.fn<TraceApi["enableExplorerEvals"]>(async () => ({
    released: true,
    offer: "enable" as const,
  }));
  const app = createApiFixture<TraceApi>({
    getExplorerEvalAccess,
    enableExplorerEvals,
    getExplorerEvalRun,
    cancelExplorerEvalRun,
    estimateExplorerEvalRun,
  });
  const permissions: string[] = [];
  const auditRows: TrpcRuntimeAuditEntry[] = [];
  const trpc = initTRPC.context<TestContext>().create();
  const members = trpcTestMembers<TestContext>({
    permits: (permission) => {
      permissions.push(permission);

      return permitted(permission);
    },
    overrides: {
      audit: {
        record: async (entry) => {
          auditRows.push(entry);
        },
        redact: ({ args }) => args,
        exempt: () => false,
        organizationOf: async ({ tier, id }) =>
          tier === "project" && id === "project-1" ? "organization-1" : null,
      },
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
    getExplorerEvalAccess,
    enableExplorerEvals,
    permissions,
    auditRows,
  };
}

describe("given the traces.instantEval tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares main's six nested procedures", () => {
      expect(
        Object.entries(tracesInstantEvalTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["estimate", "mutation"],
        ["start", "mutation"],
        ["cancel", "mutation"],
        ["get", "query"],
        ["access", "query"],
        ["enable", "mutation"],
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

describe("given the opt-in procedures", () => {
  describe("when a member reads what the popover offers", () => {
    it("asks for the reader under analytics:view", async () => {
      const { caller, getExplorerEvalAccess, permissions } = harness();

      await expect(caller.access({ projectId: "project-1" })).resolves.toEqual(OFFERED);
      expect(getExplorerEvalAccess).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "reader-1",
      });
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when an organization manager throws the switch", () => {
    it("switches it on under organization:manage for the caller", async () => {
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

  describe("when the switch is thrown", () => {
    /** @scenario "Switching Instant Eval on is audited against the organization" */
    it("records the audit row against the project's organization, as main does", async () => {
      const { caller, auditRows } = harness();

      await caller.enable({ projectId: "project-1" });

      expect(auditRows).toEqual([
        expect.objectContaining({
          userId: "reader-1",
          organizationId: "organization-1",
          projectId: "project-1",
          targetKind: "organization",
          targetId: "organization-1",
        }),
      ]);
    });
  });

  describe("when a member without organization:manage throws the switch", () => {
    it("is refused before anything is recorded", async () => {
      const { caller, enableExplorerEvals } = harness({
        permitted: (permission) => permission !== "organization:manage",
      });

      await expect(caller.enable({ projectId: "project-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(enableExplorerEvals).not.toHaveBeenCalled();
    });
  });
});
