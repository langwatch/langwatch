/**
 * @vitest-environment node
 * The Explorer's Instant Eval served under instant-eval's own `instantEval.*` wire.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import {
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeAuditEntry,
} from "@langwatch/api/trpc";
import {
  type ExplorerInstantEvalProgress,
  type InstantEvalApi,
  InstantEvalClassifierNotConfiguredError,
  instantEvalTrpc,
} from "@langwatch/instant-eval-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import * as traceContract from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { type InstantEvalBrowserApi, instantEvalTrpcTransport } from "../instant-eval.trpc.ts";

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

const OFFERED = { released: false, offer: "enable", viaConnect: false } as const;

function harness({ permitted = () => true }: { permitted?: (permission: string) => boolean } = {}) {
  const getExplorerRun = vi.fn<InstantEvalBrowserApi["getExplorerRun"]>(async () => PROGRESS);
  const cancelExplorerRun = vi.fn<InstantEvalBrowserApi["cancelExplorerRun"]>(async () => PROGRESS);
  const startExplorerRun = vi.fn<InstantEvalBrowserApi["startExplorerRun"]>(async () => PROGRESS);
  // A released project on a deployment with no judge, refused by the run service.
  const estimateExplorerRun = vi.fn<InstantEvalBrowserApi["estimateExplorerRun"]>(async () => {
    throw new InstantEvalClassifierNotConfiguredError();
  });
  const classifySearch = vi.fn<InstantEvalBrowserApi["classifySearch"]>(async () => ({
    classified: "instant_eval",
    isInstantEvalAvailable: true,
  }));
  const getOptInAccess = vi.fn(async () => OFFERED);
  const optIn = vi.fn(async () => ({
    released: true,
    offer: "enable" as const,
    viaConnect: false,
  }));
  const app = createApiFixture<InstantEvalBrowserApi>({
    instantEvals: () => createApiFixture<InstantEvalApi>({ getOptInAccess, optIn }),
    getExplorerRun,
    cancelExplorerRun,
    startExplorerRun,
    estimateExplorerRun,
    classifySearch,
  });
  const permissions: string[] = [];
  const auditRows: TrpcRuntimeAuditEntry[] = [];
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
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
  }).mount(instantEvalTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "reader-1" } }),
    cancelExplorerRun,
    getExplorerRun,
    startExplorerRun,
    estimateExplorerRun,
    classifySearch,
    getOptInAccess,
    optIn,
    permissions,
    auditRows,
  };
}

const RUN_REQUEST = {
  projectId: "project-1",
  target: "traces",
  filter: "",
  window: { from: 1_000, to: 2_000 },
  question: { instructions: "the user is annoyed" },
} as const;

/** Every tRPC contract trace's package exports, by the namespace it declares. */
function traceTrpcNamespaces(): string[] {
  return Object.values(traceContract).flatMap((value) => {
    if (typeof value !== "object" || value === null || !("members" in value)) return [];
    const namespace = "namespace" in value ? value.namespace : undefined;

    return typeof namespace === "string" ? [namespace] : [];
  });
}

describe("given the instantEval tRPC contract", () => {
  describe("when its members are read", () => {
    /** @scenario "The Explorer's seven procedures are served under instantEval" */
    it("declares the seven procedures under instantEval, and trace declares none of them", () => {
      expect(
        Object.entries(instantEvalTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["estimate", "mutation"],
        ["start", "mutation"],
        ["cancel", "mutation"],
        ["get", "query"],
        ["access", "query"],
        ["enable", "mutation"],
        ["classifySearch", "mutation"],
      ]);
      expect([instantEvalTrpc.namespace, instantEvalTrpcTransport.namespace]).toEqual([
        "instantEval",
        "instantEval",
      ]);
      expect(traceTrpcNamespaces()).not.toHaveLength(0);
      expect(traceTrpcNamespaces().filter((name) => /instantEval/i.test(name))).toEqual([]);
    });
  });
});

describe("given a member the project's permissions refuse", () => {
  describe("when they spend on a run without analytics:manage", () => {
    /** @scenario "Spending on a run asks analytics:manage" */
    it("refuses estimate, start and cancel as forbidden before the run service is asked", async () => {
      const { caller, estimateExplorerRun, startExplorerRun, cancelExplorerRun } = harness({
        permitted: (permission) => permission !== "analytics:manage",
      });

      for (const call of [
        () => caller.estimate(RUN_REQUEST),
        () => caller.start(RUN_REQUEST),
        () => caller.cancel(RUN),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(estimateExplorerRun).not.toHaveBeenCalled();
      expect(startExplorerRun).not.toHaveBeenCalled();
      expect(cancelExplorerRun).not.toHaveBeenCalled();
    });
  });

  describe("when they read without analytics:view", () => {
    /** @scenario "Reading a run asks analytics:view" */
    it("refuses get and access as forbidden before the run service is asked", async () => {
      const { caller, getExplorerRun, getOptInAccess } = harness({
        permitted: (permission) => permission !== "analytics:view",
      });

      await expect(caller.get(RUN)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.access({ projectId: "project-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getExplorerRun).not.toHaveBeenCalled();
      expect(getOptInAccess).not.toHaveBeenCalled();
    });
  });
});

const CLASSIFY_REQUEST = {
  projectId: "project-1",
  text: "frustrated users",
  timeRange: { from: 1_000, to: 2_000 },
  lensId: "conversations",
  isLangyAvailable: false,
};

describe("given a member without analytics:view asking to classify a search", () => {
  describe("when they ask instantEval.classifySearch", () => {
    /** @scenario "Classifying a search asks analytics:view" */
    it("is refused as forbidden before the classifier is asked", async () => {
      const { caller, classifySearch } = harness({
        permitted: (permission) => permission !== "analytics:view",
      });

      await expect(caller.classifySearch(CLASSIFY_REQUEST)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(classifySearch).not.toHaveBeenCalled();
    });
  });
});

describe("given the instantEval router", () => {
  describe("when a search sentence is classified", () => {
    it("hands the search context to the app under analytics:view and answers its classification", async () => {
      const { caller, classifySearch, permissions } = harness();

      await expect(caller.classifySearch(CLASSIFY_REQUEST)).resolves.toEqual({
        classified: "instant_eval",
        isInstantEvalAvailable: true,
      });
      expect(classifySearch).toHaveBeenCalledWith(CLASSIFY_REQUEST);
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when a run is read back", () => {
    it("reads it for the project under analytics:view", async () => {
      const { caller, getExplorerRun, permissions } = harness();

      await expect(caller.get(RUN)).resolves.toEqual(PROGRESS);
      expect(getExplorerRun).toHaveBeenCalledWith(RUN);
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when a run is cancelled", () => {
    it("names the caller as the requester under analytics:manage", async () => {
      const { caller, cancelExplorerRun, permissions } = harness();

      await caller.cancel(RUN);

      expect(cancelExplorerRun).toHaveBeenCalledWith({ ...RUN, requestedByUserId: "reader-1" });
      expect(permissions).toEqual(["analytics:manage"]);
    });
  });

  describe("when the deployment has no judge for a released project", () => {
    /** @scenario "A missing classifier opens the model popover and the phrase search runs" */
    it("refuses the estimate with the handled code the Explorer's popover reads", async () => {
      const { caller } = harness();

      await expect(caller.estimate(RUN_REQUEST)).rejects.toMatchObject({
        cause: { code: "instant_eval_classifier_not_configured", httpStatus: 403 },
      });
    });
  });
});

describe("given the opt-in procedures", () => {
  describe("when a member reads what the popover offers", () => {
    it("asks for the reader under analytics:view", async () => {
      const { caller, getOptInAccess, permissions } = harness();

      await expect(caller.access({ projectId: "project-1" })).resolves.toEqual(OFFERED);
      expect(getOptInAccess).toHaveBeenCalledWith({
        projectId: "project-1",
        userId: "reader-1",
      });
      expect(permissions).toEqual(["analytics:view"]);
    });
  });

  describe("when an organization manager throws the switch", () => {
    it("switches it on under organization:manage for the caller", async () => {
      const { caller, optIn, permissions } = harness();

      await expect(caller.enable({ projectId: "project-1" })).resolves.toEqual({
        released: true,
        offer: "enable",
        viaConnect: false,
      });
      expect(optIn).toHaveBeenCalledWith({
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
    /** @scenario "The opt-in switch asks organization:manage through the project" */
    it("is refused before anything is switched or audited", async () => {
      const { caller, optIn, auditRows } = harness({
        permitted: (permission) => permission !== "organization:manage",
      });

      await expect(caller.enable({ projectId: "project-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(optIn).not.toHaveBeenCalled();
      expect(auditRows).toEqual([]);
    });
  });
});
