/**
 * The ops health the usage report carries: counts under our own names, only
 * where something is wrong, and null where a section could not be read.
 * Spec: specs/self-hosting/checkup/checkup.feature, "What we send".
 */
import type {
  DashboardData,
  OpsMigrationOverview,
  PhaseMetrics,
  ProcessFleetSummary,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { OpsHealthService, type OpsHealthReaders } from "../ops-health.service.ts";

const PHASE: PhaseMetrics = {
  pending: 0,
  active: 0,
  completedPerSec: 0,
  failedPerSec: 0,
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
};

const TENANT = "project_acme_secret";

/** A dashboard reading whose rows also name a tenant, a group and an error message. */
const DASHBOARD: DashboardData = {
  totalGroups: 3,
  blockedGroups: 1,
  parkedGroups: 0,
  totalPendingJobs: 7,
  pendingDrift: 0,
  throughputIngestedPerSec: 0,
  totalCompleted: 100,
  totalFailed: 4,
  completedPerSec: 0,
  failedPerSec: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakIngestedPerSec: 0,
  redisMemoryUsedBytes: 0,
  redisMemoryPeakBytes: 0,
  redisMemoryMaxBytes: 0,
  redisConnectedClients: 0,
  redisEngineCpuPercent: null,
  processCpuPercent: 0,
  processMemoryUsedMb: 0,
  processMemoryTotalMb: 0,
  throughputHistory: [],
  pipelineTree: [
    { name: "trace_processing", pending: 7, active: 0, blocked: 1, children: [] },
    { name: "evaluation_processing", pending: 0, active: 0, blocked: 0, children: [] },
  ],
  queues: [
    {
      name: "{event-sourcing}:gq",
      displayName: "event-sourcing",
      pendingGroupCount: 2,
      blockedGroupCount: 1,
      activeGroupCount: 0,
      totalPendingJobs: 7,
      dlqCount: 2,
      parkedGroupCount: 0,
    },
    {
      name: "{quiet}:gq",
      displayName: "quiet",
      pendingGroupCount: 0,
      blockedGroupCount: 0,
      activeGroupCount: 0,
      totalPendingJobs: 0,
      dlqCount: 0,
      parkedGroupCount: 0,
    },
  ],
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
  latencyWindows: null,
  phases: { commands: PHASE, projections: PHASE, reactions: PHASE },
  jobNameMetrics: [],
  pausedKeys: [`trace_processing/${TENANT}`],
  topErrors: [
    {
      normalizedMessage: `boom for ${TENANT}`,
      sampleMessage: `boom for ${TENANT}`,
      sampleStack: null,
      count: 1,
      pipelineName: "trace_processing",
      queueName: "event-sourcing",
      sampleGroupIds: [`${TENANT}:trace_1`],
    },
  ],
  parkedTenants: [
    { tenantId: TENANT, queueName: "event-sourcing", groupCount: 1, oldestParkedMs: 1 },
  ],
  parkedTenantsBound: { included: 1, total: 1 },
  errorClustersBound: { included: 1, total: 1 },
  snapshot: {
    computedAt: Date.parse("2026-09-29T11:59:00.000Z"),
    detailComputedAt: null,
    writerId: "worker-7f9c",
    leaseEpoch: 3,
  },
};

const FLEET: ProcessFleetSummary[] = [
  {
    processName: "usageReport",
    pipelineName: "ops_usage_report",
    scheduled: true,
    instances: 1,
    overdueWakes: 1,
    pendingMessages: 0,
    overduePending: 0,
    lapsedLeases: 1,
    deadMessages: 3,
  },
];

const MIGRATIONS: OpsMigrationOverview[] = [
  {
    name: "tenant_split_v2",
    title: "Tenant split",
    description: "",
    requiresOperatorConfirmation: false,
    availableOnThisInstallation: true,
    enrolledAutomatically: true,
    counts: { migrated: 9, finalized: 0, parked: 2, rolled_back: 0 },
    enrollment: null,
    attention: [
      {
        migrationName: "tenant_split_v2",
        tenantId: TENANT,
        status: "parked",
        report: { error: `failed for ${TENANT}` },
        updatedAt: new Date(0),
      },
    ],
  },
  {
    name: "all_done",
    title: "All done",
    description: "",
    requiresOperatorConfirmation: false,
    availableOnThisInstallation: true,
    enrolledAutomatically: true,
    counts: { migrated: 0, finalized: 5, parked: 0, rolled_back: 0 },
    enrollment: null,
    attention: [],
  },
];

function health(overrides: Partial<OpsHealthReaders> = {}) {
  return OpsHealthService.create({
    findDashboardData: () => DASHBOARD,
    getFleetSummary: async () => FLEET,
    listSystemMigrations: async () => MIGRATIONS,
    ...overrides,
  }).read();
}

describe("given an install with a backlog, dead letters, a blocked group and a parked migration", () => {
  describe("when ops health is read for the report", () => {
    /** @scenario "The report carries the install's ops health as counts" */
    it("counts each under our own queue, pipeline and migration names, and leaves the healthy ones out", async () => {
      expect(await health()).toEqual({
        snapshot_at: "2026-09-29T11:59:00.000Z",
        failed_jobs_total: 4,
        queues: { "event-sourcing": { pending_jobs: 7, dead_letters: 2 } },
        pipelines: {
          trace_processing: {
            pending_jobs: 7,
            blocked_groups: 1,
            pending_messages: 0,
            dead_letters: 0,
            stalled: 0,
          },
          ops_usage_report: {
            pending_jobs: 0,
            blocked_groups: 0,
            pending_messages: 0,
            dead_letters: 3,
            stalled: 2,
          },
        },
        migrations: { tenant_split_v2: { parked: 2, rolled_back: 0 } },
      });
    });

    /** @scenario "Ops health carries no ids, payloads, error messages or tenant names" */
    it("carries no tenant, group id, writer or error message", async () => {
      const wire = JSON.stringify(await health());

      expect(wire).not.toContain(TENANT);
      expect(wire).not.toContain("boom");
      expect(wire).not.toContain("worker-7f9c");
      expect(wire).not.toContain("trace_1");
    });
  });
});

describe("given a section of ops health that cannot be read", () => {
  describe("when ops health is read for the report", () => {
    /** @scenario "An unreadable ops health section is reported as unknown, not as healthy" */
    it("answers null for each section it cannot read, never zeroes", async () => {
      const answer = await health({
        findDashboardData: () => null,
        listSystemMigrations: async () => {
          throw new Error("postgres went away");
        },
      });

      expect(answer).toEqual({
        snapshot_at: null,
        failed_jobs_total: null,
        queues: null,
        pipelines: null,
        migrations: null,
      });
    });

    it("keeps the dashboard's sections when only the process fleet fails", async () => {
      const answer = await health({
        getFleetSummary: async () => {
          throw new Error("postgres went away");
        },
      });

      expect(answer.pipelines).toBeNull();
      expect(answer.queues).toEqual({ "event-sourcing": { pending_jobs: 7, dead_letters: 2 } });
      expect(answer.migrations).toEqual({ tenant_split_v2: { parked: 2, rolled_back: 0 } });
    });
  });
});
