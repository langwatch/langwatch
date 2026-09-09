/**
 * The ops tRPC wire, pinned: every procedure name, its kind, and the access it
 * is reached behind. A rename is a cache-key change in every operator surface,
 * and a loosened access declaration is a cross-tenant read handed to somebody
 * who is not staff. The five `ops` declarations are one namespace.
 */
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import {
  opsBugReportTrpc,
  opsDashboardTrpc,
  opsEventLogTrpc,
  opsPlatformTrpc,
  opsProcessTrpc,
  opsQueueTrpc,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { opsBugReportTrpcTransport } from "../ops-bug-report.trpc.ts";
import { opsDashboardTrpcTransport } from "../ops-dashboard.trpc.ts";
import { opsEventLogTrpcTransport } from "../ops-event-log.trpc.ts";
import { opsPlatformTrpcTransport } from "../ops-platform.trpc.ts";
import { opsProcessTrpcTransport } from "../ops-process.trpc.ts";
import { opsQueueTrpcTransport } from "../ops-queue.trpc.ts";

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
      declared[wireName(procedure)] = access.kind;

      return {};
    },
    router: (record) => record,
  };

  (declaration.router as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => {
      throw new Error("the wire table never resolves an application");
    },
  );

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

  (declaration.router as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => {
      throw new Error("the wire table never resolves an application");
    },
  );

  return declared;
}

const OPS_CONTRACTS = [
  opsDashboardTrpc,
  opsQueueTrpc,
  opsProcessTrpc,
  opsEventLogTrpc,
  opsPlatformTrpc,
] as const;

const OPS_TRANSPORTS = [
  opsDashboardTrpcTransport,
  opsQueueTrpcTransport,
  opsProcessTrpcTransport,
  opsEventLogTrpcTransport,
  opsPlatformTrpcTransport,
] as const;

/** Every `ops.*` procedure name the browser calls, with its kind. */
const OPS_PROCEDURES: Readonly<Record<string, "query" | "mutation" | "subscription">> = {
  getScope: "query",
  getDashboardSnapshot: "query",
  getBadgeCounts: "query",
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
};

/** The one procedure that answers a non-operator instead of refusing them. */
const ANSWERING_PROBE = "getScope";

describe("the ops tRPC declarations", () => {
  describe("given the five parts of the ops namespace", () => {
    it("declares every procedure the operator surfaces call, once", () => {
      const declared = OPS_CONTRACTS.flatMap((contract) => Object.keys(contract.members));

      expect(declared).toHaveLength(new Set(declared).size);
      expect(declared.sort()).toEqual(Object.keys(OPS_PROCEDURES).sort());
    });

    it("mounts every one of them under the same wire namespace", () => {
      expect(OPS_CONTRACTS.map((contract) => contract.namespace)).toEqual([
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
     * Platform-tier: no id in the input names a scope, so the application
     * proves the operator standing and the declaration says so. A procedure
     * that slipped to `no-permission` here would be one nobody checks.
     */
    it("declares every procedure but the probe as service-authorized", () => {
      const access = Object.assign({}, ...OPS_TRANSPORTS.map(boundAccess)) as Record<
        string,
        string
      >;
      const relaxed = Object.entries(access)
        .filter(([, kind]) => kind !== "service-authorized")
        .map(([name]) => name);

      expect(relaxed).toEqual([ANSWERING_PROBE]);
      expect(access[ANSWERING_PROBE]).toBe("no-permission");
    });

    /**
     * Every procedure needs the operator, because every procedure gates on
     * them. One that asked for no fact would be one the application could not
     * refuse.
     */
    it("asks the mount to bind the operator on every procedure", () => {
      const facts = Object.assign({}, ...OPS_TRANSPORTS.map(boundFacts)) as Record<
        string,
        string[]
      >;

      expect(Object.keys(facts).sort()).toEqual(Object.keys(OPS_PROCEDURES).sort());
      expect(Object.values(facts).every((names) => names.includes("opsOperator"))).toBe(true);
    });
  });

  describe("given the support inbox", () => {
    it("declares its two reads under the bugReports namespace", () => {
      expect(opsBugReportTrpc.namespace).toBe("bugReports");
      expect(Object.keys(opsBugReportTrpc.members).sort()).toEqual(["getAll", "getById"]);
    });

    /**
     * A bug report carries no tenant, so there is no scope to check: the
     * declaration says so in words, and the application checks the staff list.
     */
    it("declares both reads as deliberately unchecked, on the operator fact", () => {
      expect(boundAccess(opsBugReportTrpcTransport)).toEqual({
        getAll: "no-permission",
        getById: "no-permission",
      });
      expect(boundFacts(opsBugReportTrpcTransport)).toEqual({
        getAll: ["opsOperator"],
        getById: ["opsOperator"],
      });
    });
  });
});
