import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  StaffFunctionNotFoundError,
  type StaffAccessFunctionInput,
  type StaffAccessFunctionName,
  type StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import {
  pageOf,
  rangeOf,
  isoOfMs,
  pageInputOf,
  type StaffAccessFunctionRun,
  type StaffAccessFunctionRuns,
} from "../rules/staff-access-function.rules.ts";
import { isoText } from "../rules/staff-access.rules.ts";
import type { StaffAccessActivityFunctionReadsService } from "./staff-access-activity-function-reads.service.ts";
import type { StaffAccessBillingFunctionReadsService } from "./staff-access-billing-function-reads.service.ts";
import type { StaffAccessLangyFunctionReadsService } from "./staff-access-langy-function-reads.service.ts";
import type { StaffAccessPeopleFunctionReadsService } from "./staff-access-people-function-reads.service.ts";
import type { StaffAccessPlatformFunctionReadsService } from "./staff-access-platform-function-reads.service.ts";
import type { StaffAccessTelemetryFunctionReadsService } from "./staff-access-telemetry-function-reads.service.ts";

type ReadsDeps = Readonly<{
  organizations: Pick<OrganizationApi, "listProvisioningSummaries" | "getOpsSnapshot">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  featureFlags: Pick<FeatureFlagApi, "findEnabledFlagsForOrganization">;
  entitlements: Pick<EntitlementApi, "getUsageLimits">;
  traces: Pick<TraceApi, "countIngestionByProject" | "findTracePresence">;
  evaluations: Pick<EvaluationApi, "countEvaluatorOutcomes">;
  monitors: Pick<MonitorApi, "getAllByIds">;
  apiKeys: Pick<ApiKeyApi, "findKeyFactsForOrganization">;
  ops: Pick<OpsApi, "countQueueGroupsForTenants">;
  auth: Pick<AuthApi, "findSignInFacts">;
  telemetry: Pick<StaffAccessTelemetryFunctionReadsService, "reads">;
  langy: Pick<StaffAccessLangyFunctionReadsService, "reads">;
  people: Pick<StaffAccessPeopleFunctionReadsService, "reads">;
  activity: Pick<StaffAccessActivityFunctionReadsService, "reads">;
  platform: Pick<StaffAccessPlatformFunctionReadsService, "reads">;
  billing: Pick<StaffAccessBillingFunctionReadsService, "reads">;
}>;

type Run<Name extends StaffAccessFunctionName> = StaffAccessFunctionRun<Name>;

/**
 * Each ops function's read, through the owning module's `*Api` (ARCHITECTURE.md §3): staff
 * access reads no other module's tables. An `org` function reads only the approved organization.
 */
export class StaffAccessFunctionReadsService {
  private readonly reads: StaffAccessFunctionRuns<StaffAccessFunctionName>;

  private constructor(private readonly deps: ReadsDeps) {
    this.reads = {
      "orgs.find": (call) => this.findOrganizations(call),
      "user.sign_in": (call) => this.signIn(call),
      "org.snapshot": (call) => this.snapshot(call),
      "org.ingestion_health": (call) => this.ingestionHealth(call),
      "org.trace_presence": (call) => this.tracePresence(call),
      "org.evaluator_errors": (call) => this.evaluatorErrors(call),
      "org.usage_limits": (call) => this.usageLimits(call),
      "org.api_keys": (call) => this.apiKeys(call),
      "queues.tenant": (call) => this.tenantQueues(call),
      ...deps.telemetry.reads,
      ...deps.langy.reads,
      ...deps.people.reads,
      ...deps.activity.reads,
      ...deps.platform.reads,
      ...deps.billing.reads,
    };
  }

  static create(deps: ReadsDeps): StaffAccessFunctionReadsService {
    return new StaffAccessFunctionReadsService(deps);
  }

  /** Runs `name`; `organizationId` is null only for lookup and platform functions. */
  run<Name extends StaffAccessFunctionName>({
    name,
    input,
    organizationId,
    at,
  }: {
    name: Name;
    input: unknown;
    organizationId: string | null;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<Name>> {
    const read = this.reads[name] as Run<Name>;
    return read({
      input: input as StaffAccessFunctionInput<Name>,
      organizationId: organizationId ?? "",
      at,
    });
  }

  private async findOrganizations({
    input,
  }: {
    input: StaffAccessFunctionInput<"orgs.find">;
  }): Promise<StaffAccessFunctionOutput<"orgs.find">> {
    const needle = input.query.trim().toLowerCase();
    const all = await this.deps.organizations.listProvisioningSummaries();
    const matching = all
      .filter(
        (summary) =>
          summary.id.toLowerCase() === needle ||
          summary.slug.toLowerCase().includes(needle) ||
          summary.name.toLowerCase().includes(needle),
      )
      .map((summary) => ({
        id: summary.id,
        slug: summary.slug,
        name: summary.name,
        createdAt: isoText(summary.createdAt),
      }));
    return pageOf({
      rows: matching,
      keyOf: (row) => row.id,
      name: "orgs.find",
      ...pageInputOf(input),
    });
  }

  private async signIn({
    input,
  }: {
    input: StaffAccessFunctionInput<"user.sign_in">;
  }): Promise<StaffAccessFunctionOutput<"user.sign_in">> {
    const [facts] = await this.deps.auth.findSignInFacts({ email: input.email });
    if (!facts) {
      return {
        exists: false,
        userId: null,
        createdAt: null,
        lastSignInAt: null,
        methods: [],
        passkeys: 0,
        twoStepEnabled: false,
        locked: false,
        deactivated: false,
      };
    }
    return {
      exists: true,
      userId: facts.userId,
      createdAt: isoOfMs(facts.createdAt),
      lastSignInAt: facts.lastSignInAt === null ? null : isoOfMs(facts.lastSignInAt),
      methods: [...facts.methods],
      passkeys: facts.passkeys,
      twoStepEnabled: facts.twoStepEnabled,
      locked: facts.locked,
      deactivated: facts.deactivated,
    };
  }

  private async snapshot({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.snapshot">> {
    const [snapshot, flagsOn, limits] = await Promise.all([
      this.deps.organizations.getOpsSnapshot({ organizationId }),
      this.deps.featureFlags.findEnabledFlagsForOrganization({ organizationId }),
      this.deps.entitlements.getUsageLimits({ organizationId }),
    ]);
    return {
      organizationId: snapshot.organizationId,
      createdAt: isoOfMs(snapshot.createdAt),
      plan: limits.plan,
      membersCount: snapshot.membersCount,
      pendingInvitesCount: snapshot.pendingInvitesCount,
      teamsCount: snapshot.teamsCount,
      projectIds: [...snapshot.projectIds],
      flagsOn: [...flagsOn],
    };
  }

  private async ingestionHealth({
    input,
    organizationId,
    at,
  }: {
    input: StaffAccessFunctionInput<"org.ingestion_health">;
    organizationId: string;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"org.ingestion_health">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const projectIds = await this.projectIdsOf({ organizationId });
    const counts = await this.deps.traces.countIngestionByProject({
      projectIds,
      since: range.since.epochMilliseconds,
      until: range.until.epochMilliseconds,
    });
    const rows = counts.map((count) => ({
      projectId: count.projectId,
      traces: count.traces,
      lastTraceAt: count.lastTraceAt === null ? null : isoOfMs(count.lastTraceAt),
      planLimitRefusals: count.planLimitRefusals,
    }));
    return pageOf({
      rows,
      keyOf: (row) => row.projectId,
      name: "org.ingestion_health",
      ...pageInputOf(input),
    });
  }

  private async tracePresence({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.trace_presence">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.trace_presence">> {
    const projectIds = await this.projectIdsOf({ organizationId });
    if (!projectIds.includes(input.projectId)) throw new StaffFunctionNotFoundError();
    const [found] = await this.deps.traces.findTracePresence({
      projectId: input.projectId,
      traceId: input.traceId,
    });
    return {
      projectId: input.projectId,
      traceId: input.traceId,
      stored: found !== undefined,
      firstSeenAt: found ? isoOfMs(found.firstSeenAt) : null,
      lastSeenAt: found ? isoOfMs(found.lastSeenAt) : null,
      spanCount: found?.spanCount ?? 0,
    };
  }

  private async evaluatorErrors({
    input,
    organizationId,
    at,
  }: {
    input: StaffAccessFunctionInput<"org.evaluator_errors">;
    organizationId: string;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"org.evaluator_errors">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const projectIds = await this.projectIdsOf({ organizationId });
    const outcomes = await this.deps.evaluations.countEvaluatorOutcomes({
      projectIds,
      since: range.since.epochMilliseconds,
      until: range.until.epochMilliseconds,
    });
    const monitors = await this.monitorsOf({ outcomes });
    const rows = outcomes.map((outcome) => ({
      ...monitorStateOf(monitors.get(`${outcome.projectId}/${outcome.evaluatorId}`)),
      projectId: outcome.projectId,
      evaluatorId: outcome.evaluatorId,
      evaluatorType: outcome.evaluatorType,
      runs: outcome.runs,
      errors: outcome.errors,
      skipped: outcome.skipped,
      errorsByCode: Object.fromEntries(
        outcome.errorsByCode.map(({ code, count }) => [code, count]),
      ),
      lastErrorAt: outcome.lastErrorAt === null ? null : isoOfMs(outcome.lastErrorAt),
    }));
    return pageOf({
      rows,
      keyOf: (row) => `${row.projectId}/${row.evaluatorId}`,
      name: "org.evaluator_errors",
      ...pageInputOf(input),
    });
  }

  /** The monitors behind the outcomes, by project and id; a deleted one is absent. */
  private async monitorsOf({
    outcomes,
  }: {
    outcomes: readonly { projectId: string; evaluatorId: string }[];
  }): Promise<Map<string, MonitorState>> {
    const idsByProject = new Map<string, Set<string>>();
    for (const outcome of outcomes) {
      const ids = idsByProject.get(outcome.projectId) ?? new Set<string>();
      ids.add(outcome.evaluatorId);
      idsByProject.set(outcome.projectId, ids);
    }
    const found = await Promise.all(
      [...idsByProject.entries()].map(([projectId, ids]) =>
        this.deps.monitors.getAllByIds({ projectId, monitorIds: [...ids] }),
      ),
    );
    return new Map(
      found.flat().map((monitor) => [
        `${monitor.projectId}/${monitor.id}`,
        {
          enabled: monitor.enabled,
          createdById: monitor.createdById ?? null,
          autoPausedAtMs: monitor.autoPausedAt ? monitor.autoPausedAt.getTime() : null,
        },
      ]),
    );
  }

  private async usageLimits({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.usage_limits">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.usage_limits">> {
    const { plan, limits } = await this.deps.entitlements.getUsageLimits({ organizationId });
    const rows = limits.map((limit) => ({
      plan,
      limit: limit.name,
      cap: limit.cap,
      used: limit.used,
    }));
    return pageOf({
      rows,
      keyOf: (row) => row.limit,
      name: "org.usage_limits",
      ...pageInputOf(input),
    });
  }

  private async apiKeys({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"org.api_keys">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.api_keys">> {
    const keys = await this.deps.apiKeys.findKeyFactsForOrganization({ organizationId });
    const rows = keys.map((key) => ({
      id: key.id,
      kind: key.kind,
      projectId: key.projectId,
      createdAt: isoOfMs(key.createdAt),
      lastUsedAt: key.lastUsedAt === null ? null : isoOfMs(key.lastUsedAt),
      expiresAt: key.expiresAt === null ? null : isoOfMs(key.expiresAt),
      revokedAt: key.revokedAt === null ? null : isoOfMs(key.revokedAt),
      permissions: [...key.permissions],
    }));
    return pageOf({ rows, keyOf: (row) => row.id, name: "org.api_keys", ...pageInputOf(input) });
  }

  private async tenantQueues({
    input,
    organizationId,
  }: {
    input: StaffAccessFunctionInput<"queues.tenant">;
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"queues.tenant">> {
    const projectIds = await this.projectIdsOf({ organizationId });
    const counts = await this.deps.ops.countQueueGroupsForTenants({
      tenantIds: [organizationId, ...projectIds],
    });
    const rows = counts.map((count) => ({
      queue: count.queueName,
      pendingGroups: count.pendingGroups,
      blockedGroups: count.blockedGroups,
      activeGroups: count.activeGroups,
      parkedGroups: count.parkedGroups,
      dlqGroups: count.dlqGroups,
      pendingJobs: count.pendingJobs,
      oldestPendingAt: count.oldestPendingAt === null ? null : isoOfMs(count.oldestPendingAt),
    }));
    return pageOf({
      rows,
      keyOf: (row) => row.queue,
      name: "queues.tenant",
      ...pageInputOf(input),
    });
  }

  private async projectIdsOf({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.deps.projects.listIdsByOrganization({ organizationId });
  }
}

type MonitorState = Readonly<{
  enabled: boolean;
  createdById: string | null;
  autoPausedAtMs: number | null;
}>;

/** Who created the monitor, and when and why it stopped running: paused itself, or turned off. */
function monitorStateOf(monitor: MonitorState | undefined): {
  createdByUserId: string | null;
  disabledAt: string | null;
  disabledReasonCode: "error_rate" | "manual" | null;
} {
  if (!monitor) return { createdByUserId: null, disabledAt: null, disabledReasonCode: null };
  const createdByUserId = monitor.createdById;
  if (monitor.enabled) return { createdByUserId, disabledAt: null, disabledReasonCode: null };
  if (monitor.autoPausedAtMs === null) {
    return { createdByUserId, disabledAt: null, disabledReasonCode: "manual" };
  }
  const disabledAt = isoOfMs(monitor.autoPausedAtMs);
  return { createdByUserId, disabledAt, disabledReasonCode: "error_rate" };
}
