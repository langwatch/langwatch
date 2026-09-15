// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type CostRollupDayComparer,
  type CostRollupDayLook,
  CostRollupWatchProcess,
  createIngestionPullEventing,
  createIngestionPullExecution,
  createIngestionPullLifecycle,
  createPulledUsageEventing,
  type GovernanceEventingChannel,
  type GovernanceDiagnosticsSink,
  type IngestionPullLifecycleChannel,
  type IngestionPullLifecycleService,
  type IngestionPullMetricsSink,
  type IngestionPullOutcomeChannel,
  IngestionPullProcess,
  type IngestionPullRunner,
  type IngestionPullScheduler,
  type IngestionPullTenantResolver,
  type PulledUsageDispatcher,
  type PulledUsageLedgerRepository,
  PulledUsageLedgerProcess,
  type IngestionPullLifecycleDatabase,
  type IngestionPullRunProjectionDatabase,
  type IngestionPullWorkerService,
  type PulledUsageLedgerRow,
} from "@langwatch/enterprise-governance-server";
import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  PulledUsageObservedEventData,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
  RecordPulledUsageCommand,
} from "@langwatch/enterprise-governance-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import type { EventSourcing } from "@langwatch/eventing";
import { mapCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { PROJECT_KIND } from "@langwatch/project-contract";
import type { GovernanceInternalProject } from "@langwatch/project-server";
import { nowInstant } from "@langwatch/time";
import {
  CostRollupComparatorService,
  reportCostRollupDrift,
} from "./costRollupComparator.service.ts";
import { GOVERNANCE_COST_SOURCE } from "./governanceCostRollup.constants.ts";
import { GovernanceCostRollupClickHouseRepository } from "./governanceCostRollup.clickhouse.repository.ts";

const logger = createLogger("langwatch:enterprise:governance-eventing");

type IngestionPullConfigureCommand = {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  cron: string;
  configVersion: string;
  cursor: string | null;
};

type IngestionPullDisableCommand = {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  configVersion: string;
};

type IngestionPullCompletedCommand = {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  runId: string;
  scheduledFor: number;
  nextCursor: string | null;
  eventCount: number;
};

type IngestionPullFailedCommand = {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  runId: string;
  scheduledFor: number;
  error: string;
  errorCode: string;
  retryable: boolean;
};

type PulledUsageRecordCommand = PulledUsageObservedEventData & {
  tenantId: string;
  occurredAt: number;
};

export type GovernancePulledUsageLedger = {
  insertPulledUsageRows(rows: PulledUsageLedgerRow[]): Promise<void>;
};

export type GovernanceIngestionPullMetrics = {
  count(outcome: "completed" | "failed_retryable" | "failed_final"): void;
  observeDuration(durationMs: number): void;
};

export type GovernanceIngestionPullSchedule = {
  nextRunAt(input: { cron: string; after: number }): number;
};

/**
 * The complete command surface of the one registered ingestion-pull pipeline.
 * This hides the event-sourcing command record at the composition boundary.
 */
export class AppIngestionPullPipeline {
  private constructor(
    private configureCommand: ((input: IngestionPullConfigureCommand) => Promise<void>) | undefined,
    private disableCommand: ((input: IngestionPullDisableCommand) => Promise<void>) | undefined,
    private completedCommand: ((input: IngestionPullCompletedCommand) => Promise<void>) | undefined,
    private failedCommand: ((input: IngestionPullFailedCommand) => Promise<void>) | undefined,
  ) {}

  static create(
    configure: (input: IngestionPullConfigureCommand) => Promise<void>,
    disable: (input: IngestionPullDisableCommand) => Promise<void>,
    completed: (input: IngestionPullCompletedCommand) => Promise<void>,
    failed: (input: IngestionPullFailedCommand) => Promise<void>,
  ): AppIngestionPullPipeline {
    return new AppIngestionPullPipeline(configure, disable, completed, failed);
  }

  static deferred(): AppIngestionPullPipeline {
    return new AppIngestionPullPipeline(undefined, undefined, undefined, undefined);
  }

  bind(
    configure: (input: IngestionPullConfigureCommand) => Promise<void>,
    disable: (input: IngestionPullDisableCommand) => Promise<void>,
    completed: (input: IngestionPullCompletedCommand) => Promise<void>,
    failed: (input: IngestionPullFailedCommand) => Promise<void>,
  ): void {
    this.configureCommand = configure;
    this.disableCommand = disable;
    this.completedCommand = completed;
    this.failedCommand = failed;
  }

  configure(input: IngestionPullConfigureCommand): Promise<void> {
    if (!this.configureCommand) throw new Error("Ingestion pull pipeline is not registered");
    return this.configureCommand(input);
  }

  disable(input: IngestionPullDisableCommand): Promise<void> {
    if (!this.disableCommand) throw new Error("Ingestion pull pipeline is not registered");
    return this.disableCommand(input);
  }

  recordRunCompleted(input: IngestionPullCompletedCommand): Promise<void> {
    if (!this.completedCommand) throw new Error("Ingestion pull pipeline is not registered");
    return this.completedCommand(input);
  }

  recordRunFailed(input: IngestionPullFailedCommand): Promise<void> {
    if (!this.failedCommand) throw new Error("Ingestion pull pipeline is not registered");
    return this.failedCommand(input);
  }
}

/** The complete command surface of the one registered pulled-usage pipeline. */
export class AppPulledUsagePipeline {
  private constructor(
    private readonly recordCommand: (input: PulledUsageRecordCommand) => Promise<void>,
  ) {}

  static create(
    record: (input: PulledUsageRecordCommand) => Promise<void>,
  ): AppPulledUsagePipeline {
    return new AppPulledUsagePipeline(record);
  }

  recordPulledUsage(input: PulledUsageRecordCommand): Promise<void> {
    return this.recordCommand(input);
  }
}

/**
 * Complete execution collaborators for the ingestion-pull process.
 *
 * The worker, ledger and metrics have one lifecycle: they execute one durable
 * pull intent. Keeping them together prevents callers from wiring only a
 * callback-shaped subset of the worker pipeline.
 */
export class AppIngestionPullExecutionRuntime {
  private constructor(
    readonly worker: IngestionPullWorkerService,
    readonly ledger: GovernancePulledUsageLedger | undefined,
    readonly metrics: GovernanceIngestionPullMetrics,
    readonly costRollup: GovernanceCostRollupClickHouseRepository | undefined,
  ) {}

  static create(
    worker: IngestionPullWorkerService,
    ledger: GovernancePulledUsageLedger | undefined,
    metrics: GovernanceIngestionPullMetrics,
    /**
     * The daily cost summary the drift check reads. Absent in a deployment
     * that holds no summary — the check is then not mounted at all, rather
     * than mounted to compare days against a store nobody writes.
     */
    costRollup?: GovernanceCostRollupClickHouseRepository,
  ): AppIngestionPullExecutionRuntime {
    return new AppIngestionPullExecutionRuntime(worker, ledger, metrics, costRollup);
  }
}

/**
 * The drift check's daily summary store, built here so a composition root
 * hands over its ClickHouse resolver and never names the repository class.
 */
export function createGovernanceCostRollupStore(
  resolveClient: (tenantId: string) => Promise<ClickHouseClient>,
): GovernanceCostRollupClickHouseRepository {
  return new GovernanceCostRollupClickHouseRepository(resolveClient);
}

/** Complete lifecycle collaborators for durable ingestion-pull scheduling. */
export class AppIngestionPullLifecycleRuntime {
  private constructor(
    readonly database: IngestionPullLifecycleDatabase & IngestionPullRunProjectionDatabase,
    readonly projects: GovernanceInternalProject,
    readonly schedule: GovernanceIngestionPullSchedule,
    readonly runsWorkers: boolean,
  ) {}

  static create(
    database: IngestionPullLifecycleDatabase & IngestionPullRunProjectionDatabase,
    projects: GovernanceInternalProject,
    schedule: GovernanceIngestionPullSchedule,
    runsWorkers: boolean,
  ): AppIngestionPullLifecycleRuntime {
    return new AppIngestionPullLifecycleRuntime(database, projects, schedule, runsWorkers);
  }
}

/** One process-owned Governance eventing installation. */
export class AppGovernanceEventingRuntime {
  private constructor(
    readonly execution: AppIngestionPullExecutionRuntime,
    readonly lifecycle: AppIngestionPullLifecycleRuntime,
  ) {}

  static create(
    execution: AppIngestionPullExecutionRuntime,
    lifecycle: AppIngestionPullLifecycleRuntime,
  ): AppGovernanceEventingRuntime {
    return new AppGovernanceEventingRuntime(execution, lifecycle);
  }
}

class AppPulledUsageLedger implements PulledUsageLedgerRepository {
  private constructor(private readonly repository: GovernancePulledUsageLedger) {}

  static create(repository: GovernancePulledUsageLedger): AppPulledUsageLedger {
    return new AppPulledUsageLedger(repository);
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

/**
 * The pulled lane's day comparer, behind the check's port.
 *
 * `reportDrift` is handed back on the look rather than exposed as a second
 * call, because saying a disagreement is real means naming the cells it was
 * found in: a second call would have to compare the day again and would then
 * report figures the look that decided never saw.
 */
class AppCostRollupDayComparer implements CostRollupDayComparer {
  readonly costSource = GOVERNANCE_COST_SOURCE.PULLED;

  private constructor(private readonly comparator: CostRollupComparatorService) {}

  static create(rollup: GovernanceCostRollupClickHouseRepository): AppCostRollupDayComparer {
    return new AppCostRollupDayComparer(new CostRollupComparatorService(rollup));
  }

  async compareDay({
    tenantId,
    day,
  }: {
    tenantId: string;
    day: string;
  }): Promise<CostRollupDayLook> {
    const comparison = await this.comparator.compareDay({
      tenantId,
      day,
      costSource: this.costSource,
    });
    return {
      mismatchedCells: comparison.mismatches.length,
      cellsBehind: comparison.behind.length,
      lagMs: comparison.lagMs,
      reportDrift: () => reportCostRollupDrift({ tenantId, comparison }),
    };
  }
}

/** The one named dispatch boundary between a pull worker and the durable ledger. */
export class AppPulledUsageEventDispatcher implements PulledUsageDispatcher {
  private constructor(private readonly pipeline: AppPulledUsagePipeline) {}

  static create(pipeline: AppPulledUsagePipeline): AppPulledUsageEventDispatcher {
    return new AppPulledUsageEventDispatcher(pipeline);
  }

  async recordPulledUsage(input: PulledUsageRecordCommand): Promise<void> {
    await this.pipeline.recordPulledUsage(input);
  }
}

class AppIngestionPullRun implements IngestionPullRunner {
  private constructor(
    private readonly worker: IngestionPullWorkerService,
    private readonly pulledUsage: PulledUsageDispatcher,
  ) {}

  static create(options: {
    worker: IngestionPullWorkerService;
    pulledUsage: PulledUsageDispatcher;
  }): AppIngestionPullRun {
    return new AppIngestionPullRun(options.worker, options.pulledUsage);
  }

  run(input: { sourceId: string; cursor: string | null }) {
    return this.worker.run({ ...input, pulledUsage: this.pulledUsage });
  }
}

class AppIngestionPullOutcome implements IngestionPullOutcomeChannel {
  private constructor(private readonly pipeline: AppIngestionPullPipeline) {}

  static create(pipeline: AppIngestionPullPipeline): AppIngestionPullOutcome {
    return new AppIngestionPullOutcome(pipeline);
  }

  async completed(input: IngestionPullCompletedCommand): Promise<void> {
    await this.pipeline.recordRunCompleted(input);
  }

  async failed(input: IngestionPullFailedCommand): Promise<void> {
    await this.pipeline.recordRunFailed(input);
  }
}

class AppIngestionPullMetrics implements IngestionPullMetricsSink {
  private constructor(private readonly metrics: GovernanceIngestionPullMetrics) {}

  static create(metrics: GovernanceIngestionPullMetrics): AppIngestionPullMetrics {
    return new AppIngestionPullMetrics(metrics);
  }

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.metrics.count(outcome);
  }

  observeDuration(durationMs: number): void {
    this.metrics.observeDuration(durationMs);
  }
}

class UtcIngestionPullSchedule implements IngestionPullScheduler {
  private constructor(private readonly schedule: GovernanceIngestionPullSchedule) {}

  static create(schedule: GovernanceIngestionPullSchedule): UtcIngestionPullSchedule {
    return new UtcIngestionPullSchedule(schedule);
  }

  nextRunAt(input: { cron: string; after: number }): number {
    return this.schedule.nextRunAt(input);
  }
}

class AppIngestionPullTenant implements IngestionPullTenantResolver {
  private constructor(private readonly projects: GovernanceInternalProject) {}

  static create(projects: GovernanceInternalProject): AppIngestionPullTenant {
    return new AppIngestionPullTenant(projects);
  }

  async resolveTenantId(organizationId: string): Promise<string> {
    return (
      await this.projects.ensureInternal({
        organizationId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      })
    ).id;
  }
}

class AppIngestionPullLifecycleCommand implements IngestionPullLifecycleChannel {
  private constructor(private readonly pipeline: AppIngestionPullPipeline) {}

  static create(pipeline: AppIngestionPullPipeline): AppIngestionPullLifecycleCommand {
    return new AppIngestionPullLifecycleCommand(pipeline);
  }

  async configure(input: IngestionPullConfigureCommand): Promise<void> {
    await this.pipeline.configure(input);
  }

  async disable(input: IngestionPullDisableCommand): Promise<void> {
    await this.pipeline.disable(input);
  }
}

class AppIngestionPullDiagnostics implements GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class AppPipelineGovernanceEventing implements GovernanceEventingChannel {
  private constructor(
    private readonly ingestionPull: AppIngestionPullPipeline,
    private readonly pulledUsage: AppPulledUsagePipeline,
  ) {}

  static create(
    ingestionPull: AppIngestionPullPipeline,
    pulledUsage: AppPulledUsagePipeline,
  ): AppPipelineGovernanceEventing {
    return new AppPipelineGovernanceEventing(ingestionPull, pulledUsage);
  }

  async configureIngestion(input: ConfigureIngestionPullCommand): Promise<void> {
    await this.ingestionPull.configure({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
      ...input.data,
    });
  }

  async disableIngestion(input: DisableIngestionPullCommand): Promise<void> {
    await this.ingestionPull.disable({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
      ...input.data,
    });
  }

  async recordIngestionRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void> {
    await this.ingestionPull.recordRunCompleted({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
      ...input.data,
    });
  }

  async recordIngestionRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void> {
    await this.ingestionPull.recordRunFailed({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
      ...input.data,
    });
  }

  async recordPulledUsage(input: RecordPulledUsageCommand): Promise<void> {
    await this.pulledUsage.recordPulledUsage({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? nowInstant().epochMilliseconds,
      ...input.data,
    });
  }
}

/** One installed pair of Governance pipelines and their lifecycle service. */
export class AppGovernanceEventingInstallation {
  private constructor(
    readonly ingestionPull: AppIngestionPullPipeline,
    readonly pulledUsage: AppPulledUsagePipeline,
    readonly lifecycle: IngestionPullLifecycleService,
  ) {}

  static create(
    ingestionPull: AppIngestionPullPipeline,
    pulledUsage: AppPulledUsagePipeline,
    lifecycle: IngestionPullLifecycleService,
  ): AppGovernanceEventingInstallation {
    return new AppGovernanceEventingInstallation(ingestionPull, pulledUsage, lifecycle);
  }
}

export class AppGovernanceEventingAdapter {
  private constructor(
    private readonly eventSourcing: EventSourcing,
    private readonly runtime: AppGovernanceEventingRuntime,
  ) {}

  static create(
    eventSourcing: EventSourcing,
    runtime: AppGovernanceEventingRuntime,
  ): AppGovernanceEventingAdapter {
    return new AppGovernanceEventingAdapter(eventSourcing, runtime);
  }

  static noopIngestionPullPipeline(): AppIngestionPullPipeline {
    const noop = async () => undefined;
    return AppIngestionPullPipeline.create(noop, noop, noop, noop);
  }

  static noopPulledUsagePipeline(): AppPulledUsagePipeline {
    return AppPulledUsagePipeline.create(async () => undefined);
  }

  static noopGovernancePort(): GovernanceEventingChannel {
    return AppPipelineGovernanceEventing.create(
      this.noopIngestionPullPipeline(),
      this.noopPulledUsagePipeline(),
    );
  }

  static governancePort(
    ingestionPull: AppIngestionPullPipeline,
    pulledUsage: AppPulledUsagePipeline,
  ): GovernanceEventingChannel {
    return AppPipelineGovernanceEventing.create(ingestionPull, pulledUsage);
  }

  register(): AppGovernanceEventingInstallation {
    const pulledUsagePipeline = this.eventSourcing.register(
      createPulledUsageEventing({
        ledger: this.runtime.execution.ledger
          ? PulledUsageLedgerProcess.create(
              AppPulledUsageLedger.create(this.runtime.execution.ledger),
            )
          : undefined,
        costRollupWatch: this.runtime.execution.costRollup
          ? CostRollupWatchProcess.create(
              AppCostRollupDayComparer.create(this.runtime.execution.costRollup),
            )
          : undefined,
      }),
    );
    const pulledUsageCommands = mapCommands(pulledUsagePipeline.commands);
    const pulledUsage = AppPulledUsagePipeline.create(pulledUsageCommands.recordPulledUsage);
    const ingestionPull = AppIngestionPullPipeline.deferred();
    const execution = createIngestionPullExecution({
      run: AppIngestionPullRun.create({
        worker: this.runtime.execution.worker,
        pulledUsage: AppPulledUsageEventDispatcher.create(pulledUsage),
      }),
      outcome: AppIngestionPullOutcome.create(ingestionPull),
      metrics: AppIngestionPullMetrics.create(this.runtime.execution.metrics),
    });
    const ingestionPullPipeline = this.eventSourcing.register(
      createIngestionPullEventing({
        runStatusDatabase: this.runtime.lifecycle.database,
        process: IngestionPullProcess.create({
          schedule: UtcIngestionPullSchedule.create(this.runtime.lifecycle.schedule),
          execution,
        }),
      }),
    );
    const ingestionPullCommands = mapCommands(ingestionPullPipeline.commands);
    ingestionPull.bind(
      ingestionPullCommands.configure,
      ingestionPullCommands.disable,
      ingestionPullCommands.recordRunCompleted,
      ingestionPullCommands.recordRunFailed,
    );
    const lifecycle = this.lifecycle(ingestionPull);
    this.reconcile(lifecycle);
    return AppGovernanceEventingInstallation.create(ingestionPull, pulledUsage, lifecycle);
  }

  private lifecycle(pipeline: AppIngestionPullPipeline): IngestionPullLifecycleService {
    return createIngestionPullLifecycle({
      database: this.runtime.lifecycle.database,
      tenant: AppIngestionPullTenant.create(this.runtime.lifecycle.projects),
      commands: AppIngestionPullLifecycleCommand.create(pipeline),
      diagnostics: new AppIngestionPullDiagnostics(),
    });
  }

  private reconcile(lifecycle: IngestionPullLifecycleService): void {
    if (!this.runtime.lifecycle.runsWorkers) return;
    void lifecycle
      .reconcile()
      .then(({ reconciled, failed }) => {
        if (failed > 0) {
          logger.warn(
            { reconciled, failed },
            "Some ingestion pull processes failed reconciliation; the next boot retries",
          );
        }
      })
      .catch((error: unknown) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "Ingestion pull process reconciliation failed; the next boot retries",
        );
      });
  }
}
