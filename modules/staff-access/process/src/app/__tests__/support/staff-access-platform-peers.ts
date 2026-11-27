/**
 * Stand-in reads for the platform ops functions: the upgrade ledger and serving roster, Langy's
 * mirror setting, monitors, retention and evaluator usage; `PlatformPeerState` lets a test move
 * them.
 * @see modules/staff-access/specs/staff-access-functions-platform.feature
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi, EvaluatorTypeUsage } from "@langwatch/evaluation-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import type { Monitor, MonitorApi } from "@langwatch/monitor-contract";
import type {
  OpsApi,
  OpsServingProcess,
  OpsUpgradeStatus,
  OpsUpgradeStep,
} from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

const STARTED = Date.parse("2026-11-01T08:00:00Z");
const SEEN = Date.parse("2026-11-02T09:59:00Z");

export type PlatformPeerState = {
  mirrorProjectId: string | null;
  parkedTenants: number;
  usageAsks: { since: number; until: number }[];
  /** The project ids each Langy turn-outcome read asked for. */
  langyProjectAsks: string[][];
};

export function platformPeerState(): PlatformPeerState {
  return {
    mirrorProjectId: "project_langy_mirror",
    parkedTenants: 3,
    usageAsks: [],
    langyProjectAsks: [],
  };
}

function failedStep(): OpsUpgradeStep {
  return {
    id: "trace:backfill-costs",
    kind: "data",
    release: "3.24.0",
    mode: "blocking",
    status: "failed",
    statusLabel: "Failed",
    owner: "trace",
    description: "Backfills the cost column on ACME's spans",
    finishBy: null,
    recorded: true,
    inferred: false,
    attempt: 2,
    lastError: "clickhouse_timeout: SELECT from stored_spans for ACME took 30s",
    report: { done: 4 },
    progress: null,
    waitingOn: [],
    runId: "run_1",
    startedAt: "2026-11-02T09:00:00.000Z",
    finishedAt: "2026-11-02T09:10:00.000Z",
    updatedAt: "2026-11-02T09:10:00.000Z",
  };
}

function status(): OpsUpgradeStatus {
  return {
    state: "failed",
    label: "Upgrade failed",
    tone: "red",
    reason: "trace:backfill-costs failed on host ip-10-0-0-1",
    summary: "One step failed",
    installed: "3.23.0",
    origin: "image",
    image: "ghcr.io/langwatch/langwatch:3.24.0",
    lease: null,
    lastRun: {
      id: "run_1",
      kind: "upgrade",
      release: "3.24.0",
      startedAt: "2026-11-02T09:00:00.000Z",
      finishedAt: "2026-11-02T09:10:00.000Z",
      outcome: "failed",
    },
    counts: { done: 12, failed: 1, "Waiting On Writers": 2 },
    failedStepIds: ["trace:backfill-costs"],
    failedTargets: 1,
    deprecations: [],
    version: { kind: "development", containsRelease: "3.24.0", commit: "abc1234def" },
    latestRelease: null,
    notices: [],
  };
}

function serving(): OpsServingProcess[] {
  return [
    {
      role: "api",
      image: "ghcr.io/langwatch/langwatch:3.24.0@sha256:feed",
      release: "3.24.0",
      startedAt: STARTED + 60_000,
      lastSeenAt: SEEN,
    },
    {
      role: "api",
      image: "ghcr.io/langwatch/langwatch:3.24.0",
      release: "3.24.0",
      startedAt: STARTED,
      lastSeenAt: SEEN - 30_000,
    },
    {
      role: "worker",
      image: "ghcr.io/langwatch/langwatch:3.24.0",
      release: "3.24.0",
      startedAt: STARTED,
      lastSeenAt: SEEN,
    },
  ];
}

const tenantRow = (index: number) => ({
  migrationName: "dataset:move-records",
  tenantId: `project_parked_${String(index).padStart(2, "0")}`,
  status: "parked" as const,
  report: { error: "row too large for ACME" },
  updatedAt: new Date(Date.parse("2026-11-02T09:20:00Z") - index * 60_000),
});

function monitor(overrides: Partial<Monitor>): Monitor {
  return {
    id: "monitor_1",
    projectId: "org_acme_project",
    experimentId: null,
    evaluatorId: null,
    checkType: "langevals/llm_boolean",
    name: "ACME tone check",
    slug: "acme-tone-check",
    executionMode: "ON_MESSAGE",
    enabled: false,
    preconditions: [],
    parameters: {},
    mappings: null,
    sample: 1,
    level: "trace",
    threadIdleTimeout: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-11-02T07:00:00Z"),
    autoPausedAt: new Date("2026-11-02T07:00:00Z"),
    autoPausedReason: "Most evaluations errored",
    createdById: "user_creator",
    ...overrides,
  } as Monitor;
}

export const platformPeers = {
  ops: (
    state: PlatformPeerState,
  ): Pick<
    OpsApi,
    "getUpgradeStatus" | "findServingProcesses" | "listUpgradeSteps" | "listUpgradeTenants"
  > => ({
    getUpgradeStatus: async () => status(),
    findServingProcesses: async () => serving(),
    listUpgradeSteps: async ({ status: wanted }) => ({
      items: [failedStep()].filter((step) => wanted === undefined || step.status === wanted),
      cursor: null,
    }),
    listUpgradeTenants: async ({ step, state: wanted, cursor, limit = 50 }) => {
      const rows = Array.from({ length: state.parkedTenants }, (_, index) => tenantRow(index))
        .filter((row) => step === undefined || row.migrationName === step)
        .filter((row) => wanted === undefined || row.status === wanted);
      const offset = cursor ? Number(cursor) : 0;
      const next = offset + limit;
      return {
        items: rows.slice(offset, next),
        cursor: next < rows.length ? String(next) : null,
      };
    },
  }),
  mirror: (state: PlatformPeerState): Pick<LangyApi, "getMirrorSettings"> => ({
    getMirrorSettings: () => ({ projectId: state.mirrorProjectId }),
  }),
  monitors: (): MonitorApi =>
    createApiFixture<MonitorApi>({
      getAllByIds: async ({ projectId, monitorIds }) =>
        [monitor({ projectId })].filter((found) => monitorIds.includes(found.id)),
    }),
  dataRetention: (): DataRetentionApi =>
    createApiFixture<DataRetentionApi>({
      getResolvedForProject: async () => ({ traces: 30, scenarios: 90, experiments: 180 }),
      getRetroactiveMutationProgress: async () => [
        {
          mutationId: "mutation_1",
          table: "stored_spans",
          isDone: false,
          partsToDo: 4,
          createTime: "2026-11-02T08:00:00Z",
          category: "traces",
        },
        {
          mutationId: "mutation_0",
          table: "stored_spans",
          isDone: true,
          partsToDo: 0,
          createTime: "2026-10-02T08:00:00Z",
          category: "traces",
        },
      ],
    }),
  evaluatorUsage: (state: PlatformPeerState): Pick<EvaluationApi, "countEvaluatorUsageByType"> => ({
    countEvaluatorUsageByType: async (input): Promise<EvaluatorTypeUsage[]> => {
      state.usageAsks.push(input);
      return [
        {
          evaluatorType: "langevals/llm_boolean",
          projects: 12,
          runs: 900,
          errors: 40,
          skipped: 5,
          errorsByCode: [{ code: "provider_rate_limited", count: 40 }],
        },
        {
          evaluatorType: "custom/ACME tone check (v2)",
          projects: 1,
          runs: 3,
          errors: 0,
          skipped: 0,
          errorsByCode: [],
        },
      ];
    },
  }),
};
