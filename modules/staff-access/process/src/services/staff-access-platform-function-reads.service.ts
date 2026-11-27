import { createHash } from "node:crypto";

import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import type { OpsApi, OpsServingProcess, OpsUpgradeStep } from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type {
  STAFF_ACCESS_PLATFORM_FUNCTIONS,
  StaffAccessFunctionInput,
  StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import { type Instant, Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import {
  pageOf,
  rangeOf,
  isoOfMs,
  pageInputOf,
  type StaffAccessFunctionRuns,
} from "../rules/staff-access-function.rules.ts";
import {
  imageTagOf,
  countsByPlainWord,
  plainWordOf,
  releaseOf,
  upgradeErrorCodeOf,
  utcMonthsUntil,
} from "../rules/staff-access-platform-function.rules.ts";
import { isoText } from "../rules/staff-access.rules.ts";

type PlatformReadsDeps = Readonly<{
  ops: Pick<
    OpsApi,
    "getUpgradeStatus" | "findServingProcesses" | "listUpgradeSteps" | "listUpgradeTenants"
  >;
  langy: Pick<LangyApi, "getMirrorSettings">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  dataRetention: Pick<DataRetentionApi, "getResolvedForProject" | "getRetroactiveMutationProgress">;
  traces: Pick<TraceApi, "countIngestionByProject">;
  evaluations: Pick<EvaluationApi, "countEvaluatorUsageByType">;
}>;

/** Tenant rows one step failure read walks at most, 200 a page. */
const MAX_TENANT_PAGES = 50;
const TENANT_PAGE_SIZE = 200;
const TENANT_IDS_PER_STEP = 20;
const RETENTION_MONTHS = 12;

/** The platform ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessPlatformFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_PLATFORM_FUNCTIONS>;

  private constructor(private readonly deps: PlatformReadsDeps) {
    this.reads = {
      "releases.state": (call) => this.releasesState(call),
      "upgrade.step_failures": (call) => this.stepFailures(call),
      "org.retention": (call) => this.retention(call),
      "evaluators.platform_usage": (call) => this.evaluatorUsage(call),
    };
  }

  static create(deps: PlatformReadsDeps): StaffAccessPlatformFunctionReadsService {
    return new StaffAccessPlatformFunctionReadsService(deps);
  }

  private async releasesState({
    input,
  }: {
    input: StaffAccessFunctionInput<"releases.state">;
  }): Promise<StaffAccessFunctionOutput<"releases.state">> {
    const [status, processes] = await Promise.all([
      this.deps.ops.getUpgradeStatus(),
      this.deps.ops.findServingProcesses(),
    ]);
    const mirror = this.deps.langy.getMirrorSettings();
    const version = status.version;
    const imageRelease = version.kind === "release" ? version.release : version.containsRelease;
    return {
      installedRelease: status.installed === null ? null : releaseOf(status.installed),
      imageRelease: imageRelease === null ? null : releaseOf(imageRelease),
      imageCommit:
        version.kind === "development" && version.commit ? commitOf(version.commit) : null,
      upgradeState: plainWordOf(status.state),
      stepsByStatus: countsByPlainWord(status.counts),
      failedTargets: status.failedTargets,
      lastRunOutcome: status.lastRun?.outcome ? plainWordOf(status.lastRun.outcome) : null,
      lastRunFinishedAt: status.lastRun?.finishedAt ? isoTextOf(status.lastRun.finishedAt) : null,
      services: pageOf({
        rows: servicesOf(processes),
        keyOf: (row) => `${row.role}/${row.release ?? ""}/${row.imageTag}`,
        name: "releases.state.services",
        ...pageInputOf(input),
      }),
      settings: pageOf({
        rows: [
          {
            key: "langy.mirror_project_id",
            set: mirror.projectId !== null,
            value: mirror.projectId,
          },
        ],
        keyOf: (row) => row.key,
        name: "releases.state.settings",
      }),
    };
  }

  private async stepFailures({
    input,
  }: {
    input: StaffAccessFunctionInput<"upgrade.step_failures">;
  }): Promise<StaffAccessFunctionOutput<"upgrade.step_failures">> {
    const [failedSteps, parked] = await Promise.all([
      this.deps.ops.listUpgradeSteps({ status: "failed" }),
      this.parkedTenants({ stepId: input.stepId }),
    ]);
    const steps = new Map<string, OpsUpgradeStep | null>(
      failedSteps.items.map((step) => [step.id, step]),
    );
    for (const stepId of parked.byStep.keys()) if (!steps.has(stepId)) steps.set(stepId, null);
    const rows = [...steps.entries()]
      .filter(([stepId]) => input.stepId === undefined || stepId === input.stepId)
      .map(([stepId, step]) => {
        const tenants = parked.byStep.get(stepId) ?? [];
        const lastTenantAt = Math.max(0, ...tenants.map((tenant) => tenant.updatedAt));
        const stamp = step?.finishedAt ?? step?.updatedAt;
        const lastStepAt = stamp ? Temporal.Instant.from(stamp).epochMilliseconds : 0;
        const lastAttemptAt = Math.max(lastTenantAt, lastStepAt);
        return {
          stepId,
          mode: step ? plainWordOf(step.mode) : "tenant",
          state: step ? plainWordOf(step.status) : "parked",
          attempt: step?.attempt ?? 0,
          errorCode: step?.lastError?.trim() ? upgradeErrorCodeOf(step.lastError) : null,
          failedTenants: tenants.length,
          tenantIds: tenants.slice(0, TENANT_IDS_PER_STEP).map((tenant) => tenant.tenantId),
          lastAttemptAt: lastAttemptAt > 0 ? isoOfMs(lastAttemptAt) : null,
          tenantScanComplete: parked.complete,
        };
      });
    return pageOf({
      rows,
      keyOf: (row) => row.stepId,
      name: "upgrade.step_failures",
      ...pageInputOf(input),
    });
  }

  /** Parked tenant rows by step, newest first, over at most 10,000 rows; incomplete past that. */
  private async parkedTenants({ stepId }: { stepId: string | undefined }): Promise<{
    byStep: Map<string, { tenantId: string; updatedAt: number }[]>;
    complete: boolean;
  }> {
    const byStep = new Map<string, { tenantId: string; updatedAt: number }[]>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_TENANT_PAGES; page += 1) {
      const answer = await this.deps.ops.listUpgradeTenants({
        state: "parked",
        limit: TENANT_PAGE_SIZE,
        ...(stepId === undefined ? {} : { step: stepId }),
        ...(cursor === null ? {} : { cursor }),
      });
      for (const row of answer.items) {
        const rows = byStep.get(row.migrationName) ?? [];
        rows.push({ tenantId: row.tenantId, updatedAt: row.updatedAt.getTime() });
        byStep.set(row.migrationName, rows);
      }
      cursor = answer.cursor;
      if (cursor === null) break;
    }
    return { byStep, complete: cursor === null };
  }

  private async retention({
    input,
    organizationId,
    at,
  }: {
    input: StaffAccessFunctionInput<"org.retention">;
    organizationId: string;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"org.retention">> {
    const projectIds = await this.deps.projects.listIdsByOrganization({ organizationId });
    const months = utcMonthsUntil({ at, count: RETENTION_MONTHS });
    const monthly = await Promise.all(
      months.map(async (month) => ({
        key: month.key,
        counts: await this.deps.traces.countIngestionByProject({
          projectIds,
          since: month.since,
          until: month.until,
        }),
      })),
    );
    const rows = await Promise.all(
      projectIds.map(async (projectId) => {
        const [resolved, rewrites] = await Promise.all([
          this.deps.dataRetention.getResolvedForProject({ projectId }),
          this.deps.dataRetention.getRetroactiveMutationProgress({ projectId }),
        ]);
        const tracesByMonth = Object.fromEntries(
          monthly.map(({ key, counts }) => [
            key,
            counts.find((count) => count.projectId === projectId)?.traces ?? 0,
          ]),
        );
        const oldest = Object.entries(tracesByMonth).find(([, traces]) => traces > 0);
        return {
          projectId,
          tracesRetentionDays: resolved.traces,
          scenariosRetentionDays: resolved.scenarios,
          experimentsRetentionDays: resolved.experiments,
          tracesByMonth,
          oldestMonthWithTraces: oldest ? oldest[0] : null,
          pendingRetentionRewrites: rewrites.filter((rewrite) => !rewrite.isDone).length,
        };
      }),
    );
    return pageOf({
      rows,
      keyOf: (row) => row.projectId,
      name: "org.retention",
      ...pageInputOf(input),
    });
  }

  private async evaluatorUsage({
    input,
    at,
  }: {
    input: StaffAccessFunctionInput<"evaluators.platform_usage">;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"evaluators.platform_usage">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const usage = await this.deps.evaluations.countEvaluatorUsageByType({
      since: range.since.epochMilliseconds,
      until: range.until.epochMilliseconds,
    });
    const keyed = usage.map((type) => ({
      key: evaluatorUsageKeyOf(type.evaluatorType),
      row: {
        evaluatorType: evaluatorTypeOf(type.evaluatorType),
        projects: type.projects,
        runs: type.runs,
        errors: type.errors,
        skipped: type.skipped,
        errorsByCode: Object.fromEntries(type.errorsByCode.map(({ code, count }) => [code, count])),
      },
    }));
    const page = pageOf({
      rows: keyed,
      keyOf: (entry) => entry.key,
      name: "evaluators.platform_usage",
      ...pageInputOf(input),
    });
    return { ...page, items: page.items.map((entry) => entry.row) };
  }
}

const EVALUATOR_TYPE = /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/i;
const COMMIT = /^[0-9a-f]{7,40}$/i;

/** A stored evaluator type as a plain path of words, else "other"; never a free name. */
function evaluatorTypeOf(value: string): string {
  return value.length <= 100 && EVALUATOR_TYPE.test(value) ? value : "other";
}

/** A page key per stored type: the type itself, or for each "other" one a digest of it. */
function evaluatorUsageKeyOf(value: string): string {
  const type = evaluatorTypeOf(value);
  if (type !== "other") return type;
  return `other:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function commitOf(value: string): string {
  return COMMIT.test(value) ? value : "other";
}

/** One row per role, release and image tag: how many processes, since when, last seen. */
function servicesOf(processes: readonly OpsServingProcess[]) {
  const byService = new Map<
    string,
    {
      role: string;
      release: string | null;
      imageTag: string;
      processes: number;
      startedAt: number;
      seenAt: number;
    }
  >();
  for (const serving of processes) {
    const role = plainWordOf(serving.role);
    const release = serving.release === null ? null : releaseOf(serving.release);
    const imageTag = imageTagOf(serving.image);
    const key = `${role}/${release ?? ""}/${imageTag}`;
    const row = byService.get(key) ?? {
      role,
      release,
      imageTag,
      processes: 0,
      startedAt: serving.startedAt,
      seenAt: serving.lastSeenAt,
    };
    row.processes += 1;
    row.startedAt = Math.min(row.startedAt, serving.startedAt);
    row.seenAt = Math.max(row.seenAt, serving.lastSeenAt);
    byService.set(key, row);
  }
  return [...byService.values()].map(({ startedAt, seenAt, ...row }) => ({
    ...row,
    since: isoOfMs(startedAt),
    lastSeenAt: isoOfMs(seenAt),
  }));
}

function isoTextOf(text: string): string {
  return isoText(Temporal.Instant.from(text));
}
