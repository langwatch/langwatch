import type {
  OpsUpgradeIdInput,
  OpsUpgradeListRunsInput,
  OpsUpgradeListStepsInput,
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
} from "@langwatch/ops-contract";
import { UpgradeStepNotFailedError } from "@langwatch/ops-contract";
import type {
  UpgradeReleaseSummary,
  UpgradeRunDetail,
  UpgradeRunPhaseView,
  UpgradeRunSummary,
  UpgradeStatus,
  UpgradeStepDetail,
  UpgradeStepView,
  UpgradeTargetView,
} from "@langwatch/upgrade/reader";

import type { UpgradeLedgerRepository } from "../repositories/upgrade-ledger.repository.ts";

function runSummaryOf(run: UpgradeRunSummary): OpsUpgradeRunSummary {
  const { id, kind, release, floor, startedAt, finishedAt, outcome } = run;
  return { id, kind, release, floor, startedAt, finishedAt, outcome };
}

function statusOf(status: UpgradeStatus): OpsUpgradeStatus {
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
    floor: status.floor,
    ledgerFloor: status.ledgerFloor,
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
    recorded: step.recorded,
    inferred: step.inferred,
    attempt: step.attempt,
    lastError: step.lastError,
    report: step.report,
    progress: step.progress,
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

/**
 * The Upgrades pages' reads over UpgradeReader (round 8, U2-API), mapped field by field into
 * ops' own contract shapes; the reader's `upgrade_not_found` passes through.
 * Spec: modules/ops/specs/upgrades.feature
 */
export class OpsUpgradeService {
  static create({ ledger }: { ledger: UpgradeLedgerRepository }): OpsUpgradeService {
    return new OpsUpgradeService(ledger);
  }

  private constructor(private readonly ledger: UpgradeLedgerRepository) {}

  async getStatus(): Promise<OpsUpgradeStatus> {
    return statusOf(await this.ledger.findStatus());
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

  /** Reopens a failed step for the worker's next sweep, its checkpoint kept (D6). */
  async retryStep({ id }: OpsUpgradeIdInput): Promise<OpsUpgradeStepDetail> {
    if (!(await this.ledger.reopenFailedStep({ id }))) {
      const { status } = await this.ledger.getStep({ id });
      throw new UpgradeStepNotFailedError({ stepId: id, status });
    }
    return stepDetailOf(await this.ledger.getStep({ id }));
  }
}
