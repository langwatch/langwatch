/**
 * The ops tRPC wire, pinned: every procedure name, its kind, and the access
 * it is reached behind. A rename is a cache-key change everywhere; a
 * loosened access is a cross-tenant read handed to a non-staff caller.
 */
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import {
  opsBugReportTrpc,
  opsDashboardTrpc,
  opsEventLogTrpc,
  opsOperatorsTrpc,
  opsPlatformTrpc,
  opsProcessTrpc,
  opsQueueTrpc,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { opsBugReportTrpcTransport } from "../ops-bug-report.trpc.ts";
import { opsDashboardTrpcTransport } from "../ops-dashboard.trpc.ts";
import { opsEventLogTrpcTransport } from "../ops-event-log.trpc.ts";
import { opsOperatorsTrpcTransport } from "../ops-operators.trpc.ts";
import { opsPlatformTrpcTransport } from "../ops-platform.trpc.ts";
import { opsProcessTrpcTransport } from "../ops-process.trpc.ts";
import { opsQueueTrpcTransport } from "../ops-queue.trpc.ts";
import { opsTrpcTransport } from "../ops.trpc.ts";

type Declaration = { router: TrpcRouterMount<never, never> };

/** The name a procedure is bound under, without the namespace it sits in. */
function wireName(procedure: string): string {
  return procedure.slice(procedure.indexOf(".") + 1);
}

/** Every procedure a declaration binds, with the access it asked for. */
function boundAccess(declaration: Declaration): Record<string, string> {
  const declared: Record<string, string> = {};

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared[wireName(procedure)] =
        access.kind === "permission-platform" ? `${access.kind}:${access.permission}` : access.kind;

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return declared;
}

/** Every fact a declaration asks the mount to bind, by procedure. */
function boundFacts(declaration: Declaration): Record<string, string[]> {
  const declared: Record<string, string[]> = {};

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, facts }) => {
      declared[wireName(procedure)] = facts.map((fact) => fact.name);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return declared;
}

const OPS_CONTRACTS = [
  opsDashboardTrpc,
  opsQueueTrpc,
  opsProcessTrpc,
  opsEventLogTrpc,
  opsPlatformTrpc,
  opsOperatorsTrpc,
] as const;

const OPS_TRANSPORTS = [
  opsDashboardTrpcTransport,
  opsQueueTrpcTransport,
  opsProcessTrpcTransport,
  opsEventLogTrpcTransport,
  opsPlatformTrpcTransport,
  opsOperatorsTrpcTransport,
] as const;

/** Every `ops.*` procedure name the browser calls, with its kind. */
const OPS_PROCEDURES: Readonly<Record<string, "query" | "mutation" | "subscription">> = {
  getScope: "query",
  getDashboardSnapshot: "query",
  getBadgeCounts: "query",
  getSignUpHealth: "query",
  dashboardStream: "subscription",
  listParkedGroups: "query",
  listQueues: "query",
  listScheduledJobs: "query",
  listPausedSchedules: "query",
  listSchedulerActions: "query",
  setScheduleActive: "mutation",
  clearScheduleSlot: "mutation",
  runScheduleNow: "mutation",
  listGroups: "query",
  getGroupDetail: "query",
  getGrafanaLinkConfig: "query",
  getBlockedSummary: "query",
  getGroupJobs: "query",
  unblockGroup: "mutation",
  unblockAll: "mutation",
  drainGroup: "mutation",
  pausePipeline: "mutation",
  unpausePipeline: "mutation",
  pauseTenant: "mutation",
  unpauseTenant: "mutation",
  listPausedTenants: "query",
  drainTenant: "mutation",
  retryBlocked: "mutation",
  listProjections: "query",
  listDlqGroups: "query",
  listAllDlqGroups: "query",
  listPausedKeys: "query",
  drainAllBlockedPreview: "query",
  moveToDlq: "mutation",
  moveAllBlockedToDlq: "mutation",
  replayFromDlq: "mutation",
  replayAllFromDlq: "mutation",
  redriveManyFromDlq: "mutation",
  discardManyFromDlq: "mutation",
  canaryRedrive: "mutation",
  canaryUnblock: "mutation",
  getAggregateProcessManagers: "query",
  requeueDeadOutboxMessages: "mutation",
  listProcessFleet: "query",
  listDeadLetters: "query",
  listDeadLetterCounts: "query",
  listProcessInstances: "query",
  listUpcomingWakes: "query",
  getProcessInstance: "query",
  listProcessOutbox: "query",
  listProcessActions: "query",
  processWakeNow: "mutation",
  processRedriveDeadInstance: "mutation",
  processRedriveDeadMessage: "mutation",
  processDiscardDeadMessage: "mutation",
  redriveDeadLetters: "mutation",
  discardDeadLetters: "mutation",
  listOutboxAttempts: "query",
  processReleaseLapsedLease: "mutation",
  searchAggregates: "query",
  getEventLogSearchWindow: "query",
  loadAggregateEvents: "query",
  computeProjectionState: "query",
  discoverAggregates: "query",
  searchTenants: "query",
  dryRunReplay: "mutation",
  getReplayHistory: "query",
  getReplayRun: "query",
  startReplay: "mutation",
  getReplayStatus: "query",
  cancelReplay: "mutation",
  listAnomalies: "query",
  dismissAnomaly: "mutation",
  listFeatureFlags: "query",
  setFeatureFlag: "mutation",
  setFeatureFlagRules: "mutation",
  clearFeatureFlag: "mutation",
  listBlobQueues: "query",
  getBlobStoreStats: "query",
  listBlobs: "query",
  getBlob: "query",
  runBlobCleanup: "mutation",
  deleteBlob: "mutation",
  listSystemMigrations: "query",
  listMigrationEnrollments: "query",
  searchMigrationOrganizations: "query",
  enrollMigrationTenant: "mutation",
  enrollMigrationCohort: "mutation",
  withdrawMigrationTenant: "mutation",
  runSystemMigrationForOrganization: "mutation",
  runSystemMigrationPass: "mutation",
  assertSystemMigrationLegacyWritersDrained: "mutation",
  rollBackSystemMigrationTenant: "mutation",
  listPlatformOperators: "query",
  grantPlatformOperator: "mutation",
  revokePlatformOperator: "mutation",
};

/** The one procedure that answers a non-operator instead of refusing them. */
const ANSWERING_PROBE = "getScope";

/** The procedures whose handler reads the operator's name, email or impersonation. */
const OPERATOR_READERS = [
  ANSWERING_PROBE,
  "startReplay",
  "grantPlatformOperator",
  "revokePlatformOperator",
  "runBlobCleanup",
  "deleteBlob",
  "enrollMigrationTenant",
  "enrollMigrationCohort",
  "runSystemMigrationForOrganization",
  "runSystemMigrationPass",
  "assertSystemMigrationLegacyWritersDrained",
  "rollBackSystemMigrationTenant",
];

describe("the ops tRPC declarations", () => {
  describe("given the six parts of the ops namespace", () => {
    it("declares every procedure the operator surfaces call, once", () => {
      const declared = OPS_CONTRACTS.flatMap((contract) => Object.keys(contract.members));

      expect(declared).toHaveLength(new Set(declared).size);
      expect(declared.toSorted()).toEqual(Object.keys(OPS_PROCEDURES).toSorted());
    });

    it("mounts every one of them under the same wire namespace", () => {
      expect(OPS_CONTRACTS.map((contract) => contract.namespace)).toEqual([
        "ops",
        "ops",
        "ops",
        "ops",
        "ops",
        "ops",
      ]);
    });

    it("reads with a query, changes with a mutation and streams with a subscription", () => {
      const kinds = Object.fromEntries(
        OPS_CONTRACTS.flatMap((contract) =>
          Object.entries(contract.members).map(([name, member]) => [name, member.kind]),
        ),
      );

      expect(kinds).toEqual(OPS_PROCEDURES);
    });
  });

  describe("given the server bindings", () => {
    /**
     * Platform-tier: no id in the input names a scope, so the door asks the operator's platform
     * grant. A procedure that slipped to `no-permission` here would be one nobody checks.
     */
    it("declares every procedure but the probe at the platform tier", () => {
      const access = Object.assign({}, ...OPS_TRANSPORTS.map(boundAccess)) as Record<
        string,
        string
      >;
      const relaxed = Object.entries(access)
        .filter(([, kind]) => !kind.startsWith("permission-platform:"))
        .map(([name]) => name);

      expect(relaxed).toEqual([ANSWERING_PROBE]);
      expect(access[ANSWERING_PROBE]).toBe("no-permission");
    });

    it("asks ops:manage of every mutation", () => {
      const access = Object.assign({}, ...OPS_TRANSPORTS.map(boundAccess)) as Record<
        string,
        string
      >;
      const mutations = Object.entries(OPS_PROCEDURES)
        .filter(([, kind]) => kind === "mutation")
        .map(([name]) => name);

      expect(mutations.filter((name) => access[name] !== "permission-platform:ops:manage")).toEqual(
        [],
      );
    });

    /** The operator is bound only where the handler reads the person, beyond who may call it. */
    it("binds the operator only where the handler reads who it is", () => {
      const facts = Object.assign({}, ...OPS_TRANSPORTS.map(boundFacts)) as Record<
        string,
        string[]
      >;
      const reading = Object.entries(facts)
        .filter(([, names]) => names.includes("opsOperator"))
        .map(([name]) => name);

      expect(reading.toSorted()).toEqual(OPERATOR_READERS.toSorted());
    });
  });

  /**
   * Five declarations, one claim: a process mounts one router per namespace,
   * so the parts must arrive as a single declaration. A part that fell out
   * would leave its procedures unreachable with nothing failing at boot.
   */
  describe("given the one declaration the process mounts", () => {
    it("claims the ops namespace once, over every part's procedures", () => {
      expect(opsTrpcTransport.namespace).toBe("ops");
      expect(Object.keys(opsTrpcTransport.contract.members).toSorted()).toEqual(
        Object.keys(OPS_PROCEDURES).toSorted(),
      );
    });

    it("binds each procedure with the access and the facts its own part declared", () => {
      expect(boundAccess(opsTrpcTransport)).toEqual(
        Object.assign({}, ...OPS_TRANSPORTS.map(boundAccess)),
      );
      expect(boundFacts(opsTrpcTransport)).toEqual(
        Object.assign({}, ...OPS_TRANSPORTS.map(boundFacts)),
      );
    });
  });

  describe("given the support inbox", () => {
    it("declares its two reads under the bugReports namespace", () => {
      expect(opsBugReportTrpc.namespace).toBe("bugReports");
      expect(Object.keys(opsBugReportTrpc.members).toSorted()).toEqual(["getAll", "getById"]);
    });

    /** A bug report carries no tenant, so the door asks the operator's platform grant. */
    it("declares both reads at the platform tier, with no operator fact", () => {
      expect(boundAccess(opsBugReportTrpcTransport)).toEqual({
        getAll: "permission-platform:ops:view",
        getById: "permission-platform:ops:view",
      });
      expect(boundFacts(opsBugReportTrpcTransport)).toEqual({ getAll: [], getById: [] });
    });
  });
});
