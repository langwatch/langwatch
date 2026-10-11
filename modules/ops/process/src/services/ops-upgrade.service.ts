import type {
  OpsUpgradeAttentionNotice,
  OpsUpgradeDeprecation,
  OpsUpgradeIdInput,
  OpsUpgradeListRunsInput,
  OpsUpgradeListStepsInput,
  OpsUpgradeLatestRelease,
  OpsUpgradeRelease,
  OpsUpgradeReleasePage,
  OpsUpgradeRun,
  OpsUpgradeRunPage,
  OpsUpgradeRunPhase,
  OpsUpgradeRunSummary,
  OpsUpgradeStatus,
  OpsUpgradeStep,
  OpsUpgradeStepDetail,
  OpsUpgradeStepPage,
  OpsUpgradeTarget,
  OpsUpgradeTargetSummary,
} from "@langwatch/ops-contract";
import { UpgradeStepNotFailedError } from "@langwatch/ops-contract";
import type { Deprecation } from "@langwatch/upgrade/manifest";
import type {
  UpgradeImageVersion,
  UpgradeReleaseSummary,
  UpgradeRunDetail,
  UpgradeRunPhaseView,
  UpgradeRunSummary,
  UpgradeStatus,
  UpgradeStepDetail,
  UpgradeStepView,
  UpgradeTargetSummary,
  UpgradeTargetView,
} from "@langwatch/upgrade/reader";
import { orderReleases } from "@langwatch/upgrade/reader";

import type { ClickHouseRoutesRepository } from "../repositories/clickhouse.routes.repository.ts";
import type { CloudLatestRelease } from "../repositories/cloud-latest-release.repository.ts";
import type { UpgradeLedgerRepository } from "../repositories/upgrade-ledger.repository.ts";
import type { UsageReportService } from "./usage-report.service.ts";

/** The reader's state for a failed step, target or run: Ops › Upgrades' "Needs attention". */
const NEEDS_ATTENTION = "needs-attention";

function runSummaryOf(run: UpgradeRunSummary): OpsUpgradeRunSummary {
  const { id, kind, release, startedAt, finishedAt, outcome } = run;
  return { id, kind, release, startedAt, finishedAt, outcome };
}

function deprecationOf(entry: Deprecation): OpsUpgradeDeprecation {
  const { id, what, kind, deprecatedIn, removedIn, notice } = entry;
  return { id, what, kind, deprecatedIn, removedIn, successor: entry.successor ?? null, notice };
}

function statusOf(
  status: UpgradeStatus,
): Omit<OpsUpgradeStatus, "deprecations" | "version" | "latestRelease"> {
  const { lease, lastRun } = status;
  return {
    state: status.state,
    label: status.label,
    tone: status.tone,
    reason: status.reason,
    summary: status.summary,
    installed: status.installed,
    origin: status.origin,
    image: status.image,
    lease: lease && {
      name: lease.name,
      owner: lease.owner,
      image: lease.image,
      host: lease.host,
      heartbeatAt: lease.heartbeatAt,
      expiresAt: lease.expiresAt,
    },
    lastRun: lastRun && runSummaryOf(lastRun),
    counts: { ...status.counts },
    failedStepIds: [...status.failedStepIds],
    failedTargets: status.failedTargets,
  };
}

function releaseOf(release: UpgradeReleaseSummary): OpsUpgradeRelease {
  const { installed, image, stepCount, counts } = release;
  return { release: release.release, installed, image, stepCount, counts: { ...counts } };
}

function stepOf(step: UpgradeStepView): OpsUpgradeStep {
  return {
    id: step.id,
    kind: step.kind,
    release: step.release,
    mode: step.mode,
    status: step.status,
    statusLabel: step.statusLabel,
    owner: step.owner,
    description: step.description,
    finishBy: step.finishBy,
    recorded: step.recorded,
    inferred: step.inferred,
    attempt: step.attempt,
    lastError: step.lastError,
    report: step.report,
    progress: step.progress,
    waitingOn: step.waitingOn.map((writer) => ({ ...writer })),
    runId: step.runId,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    updatedAt: step.updatedAt,
  };
}

function targetOf(target: UpgradeTargetView): OpsUpgradeTarget {
  const { status, version, lastError, updatedAt } = target;
  return { target: target.target, status, version, lastError, updatedAt };
}

function phaseOf(phase: UpgradeRunPhaseView): OpsUpgradeRunPhase {
  const { name, release, startedAt, finishedAt, outcome } = phase;
  return { name, release, startedAt, finishedAt, outcome };
}

function stepDetailOf(step: UpgradeStepDetail): OpsUpgradeStepDetail {
  return { ...stepOf(step), targets: step.targets.map(targetOf) };
}

function runOf(run: UpgradeRunDetail): OpsUpgradeRun {
  return {
    ...runSummaryOf(run),
    plan: run.plan,
    report: run.report,
    phases: run.phases.map(phaseOf),
    steps: run.steps.map(stepOf),
  };
}

/** The release page every LangWatch release is tagged with: `langwatch@v<release>`. */
function releaseNotesUrl({ release }: { release: string }): string {
  return `https://github.com/langwatch/langwatch/releases/tag/langwatch@v${release}`;
}

/** Cloud's latest release, kept only when newer than the release this image is or holds. */
function newerReleasesOf({
  version,
  held,
}: {
  version: UpgradeImageVersion;
  held: readonly CloudLatestRelease[];
}): OpsUpgradeLatestRelease[] {
  const running = version.kind === "release" ? version.release : version.containsRelease;
  return held
    .filter(
      (latest) =>
        running === null || orderReleases({ left: latest.release, right: running }) === "newer",
    )
    .map(({ release }) => ({ release, notesUrl: releaseNotesUrl({ release }) }));
}

/** The ledger's prefix for a private ClickHouse target: `private:<organizationId>`. */
const PRIVATE_TARGET_PREFIX = "private:";

/** The routes this process holds, read to tell a reachable private target from a refused one. */
type TargetRoutes = Pick<
  ClickHouseRoutesRepository,
  "findPrivateRoutes" | "findPrivateRouteVariables"
>;

/** Whether this process reaches a target: shared always; a private one by its variable. */
function routeOf({
  target,
  routes,
}: {
  target: string;
  routes: TargetRoutes | undefined;
}): OpsUpgradeTargetSummary["route"] {
  if (!target.startsWith(PRIVATE_TARGET_PREFIX)) return "present";
  const organizationId = target.slice(PRIVATE_TARGET_PREFIX.length);
  if (routes?.findPrivateRoutes().has(organizationId)) return "present";
  const malformed = routes
    ?.findPrivateRouteVariables()
    .some((each) => each.organizationId === organizationId && each.state === "malformed");
  return malformed ? "malformed" : "missing";
}

function targetSummaryOf({
  summary,
  routes,
}: {
  summary: UpgradeTargetSummary;
  routes: TargetRoutes | undefined;
}): OpsUpgradeTargetSummary {
  const { target, version, outstanding, lastError } = summary;
  return { target, version, outstanding, lastError, route: routeOf({ target, routes }) };
}

/**
 * The Upgrades pages' reads over UpgradeReader (round 8, U2-API), mapped field by field into
 * ops' own contract shapes; the reader's `upgrade_not_found` passes through.
 * Spec: modules/ops/specs/upgrades.feature
 */
export class OpsUpgradeService {
  static create({
    ledger,
    cloudReleases,
    isSaas,
    routes,
  }: {
    ledger: UpgradeLedgerRepository;
    /** The private routes this process holds; absent, every private target reads as missing. */
    routes?: TargetRoutes;
    /** Cloud tells no member about its upgrades; only ops:view holders see them. */
    isSaas: boolean;
    /** The usage report's held reply; a process without one names no latest release. */
    cloudReleases?: Pick<UsageReportService, "findLatestRelease">;
  }): OpsUpgradeService {
    return new OpsUpgradeService({ ledger, cloudReleases, isSaas, routes });
  }

  private readonly ledger: UpgradeLedgerRepository;
  private readonly cloudReleases: Pick<UsageReportService, "findLatestRelease"> | undefined;
  private readonly isSaas: boolean;
  private readonly routes: TargetRoutes | undefined;

  private constructor(parts: {
    ledger: UpgradeLedgerRepository;
    cloudReleases: Pick<UsageReportService, "findLatestRelease"> | undefined;
    isSaas: boolean;
    routes: TargetRoutes | undefined;
  }) {
    this.ledger = parts.ledger;
    this.cloudReleases = parts.cloudReleases;
    this.isSaas = parts.isSaas;
    this.routes = parts.routes;
  }

  /** A failed step, target or run on self-hosted; held organizations leave the state up to date. */
  async getAttentionNotice(): Promise<OpsUpgradeAttentionNotice> {
    if (this.isSaas) return { show: false };
    const status = await this.ledger.findStatus();
    return { show: status.state === NEEDS_ATTENTION };
  }

  async getStatus(): Promise<OpsUpgradeStatus> {
    const deprecations = this.ledger.findDeprecations().map(deprecationOf);
    const version = this.ledger.findImageVersion();
    const [status, held] = await Promise.all([
      this.ledger.findStatus(),
      this.cloudReleases?.findLatestRelease() ?? [],
    ]);
    const [latestRelease = null] = newerReleasesOf({ version, held });
    return { ...statusOf(status), deprecations, version: { ...version }, latestRelease };
  }

  async listReleases(): Promise<OpsUpgradeReleasePage> {
    const page = await this.ledger.findReleases();
    return { items: page.items.map(releaseOf), cursor: page.cursor };
  }

  async listSteps(filter: OpsUpgradeListStepsInput): Promise<OpsUpgradeStepPage> {
    const page = await this.ledger.findSteps(filter);
    return { items: page.items.map(stepOf), cursor: page.cursor };
  }

  async getStep({ id }: OpsUpgradeIdInput): Promise<OpsUpgradeStepDetail> {
    return stepDetailOf(await this.ledger.getStep({ id }));
  }

  async listRuns(input: OpsUpgradeListRunsInput): Promise<OpsUpgradeRunPage> {
    const page = await this.ledger.findRuns(input);
    return { items: page.items.map(runSummaryOf), cursor: page.cursor };
  }

  async getRun({ id }: OpsUpgradeIdInput): Promise<OpsUpgradeRun> {
    return runOf(await this.ledger.getRun({ id }));
  }

  async listTargets(): Promise<OpsUpgradeTargetSummary[]> {
    return (await this.ledger.findTargets()).map((summary) =>
      targetSummaryOf({ summary, routes: this.routes }),
    );
  }

  /** Reopens a failed step for the worker's next sweep, its checkpoint kept (D6). */
  async retryStep({ id }: OpsUpgradeIdInput): Promise<OpsUpgradeStepDetail> {
    if (!(await this.ledger.reopenFailedStep({ id }))) {
      const { status } = await this.ledger.getStep({ id });
      throw new UpgradeStepNotFailedError({ stepId: id, status });
    }
    return stepDetailOf(await this.ledger.getStep({ id }));
  }
}
