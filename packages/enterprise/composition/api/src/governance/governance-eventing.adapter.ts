// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceEventingPort,
  GovernanceDiagnosticsPort,
  IngestionPullEventingAdapter,
  IngestionPullLifecycleCommandPort,
  type IngestionPullLifecycleService,
  IngestionPullMetricsPort,
  IngestionPullOutcomePort,
  IngestionPullProcess,
  IngestionPullRunPort,
  IngestionPullSchedulePort,
  IngestionPullService,
  IngestionPullTenantPort,
  PostgresIngestionPullLifecycleAdapter,
  PostgresIngestionPullRunProjectionAdapter,
  PulledUsageDispatcherPort,
  PulledUsageEventingAdapter,
  PulledUsageLedgerPort,
  PulledUsageLedgerProcess,
  type IngestionPullLifecycleDatabase,
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
import type { EventSourcing } from "@langwatch/eventing";
import { mapCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { PROJECT_KIND } from "@langwatch/project-contract";
import type { GovernanceInternalProjectPort } from "@langwatch/project-server";

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

export type GovernancePulledUsageLedgerPort = {
  insertPulledUsageRows(rows: PulledUsageLedgerRow[]): Promise<void>;
};

export type GovernanceIngestionPullMetricsPort = {
  count(outcome: "completed" | "failed_retryable" | "failed_final"): void;
  observeDuration(durationMs: number): void;
};

export type GovernanceIngestionPullSchedulePort = {
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
    readonly ledger: GovernancePulledUsageLedgerPort | undefined,
    readonly metrics: GovernanceIngestionPullMetricsPort,
  ) {}

  static create(
    worker: IngestionPullWorkerService,
    ledger: GovernancePulledUsageLedgerPort | undefined,
    metrics: GovernanceIngestionPullMetricsPort,
  ): AppIngestionPullExecutionRuntime {
    return new AppIngestionPullExecutionRuntime(worker, ledger, metrics);
  }
}

/** Complete lifecycle collaborators for durable ingestion-pull scheduling. */
export class AppIngestionPullLifecycleRuntime {
  private constructor(
    readonly database: IngestionPullLifecycleDatabase,
    readonly projects: GovernanceInternalProjectPort,
    readonly schedule: GovernanceIngestionPullSchedulePort,
    readonly runsWorkers: boolean,
  ) {}

  static create(
    database: IngestionPullLifecycleDatabase,
    projects: GovernanceInternalProjectPort,
    schedule: GovernanceIngestionPullSchedulePort,
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

class AppPulledUsageLedgerPort extends PulledUsageLedgerPort {
  private constructor(private readonly repository: GovernancePulledUsageLedgerPort) {
    super();
  }

  static create(repository: GovernancePulledUsageLedgerPort): AppPulledUsageLedgerPort {
    return new AppPulledUsageLedgerPort(repository);
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

/** The one named dispatch boundary between a pull worker and the durable ledger. */
export class AppPulledUsageEventDispatcher extends PulledUsageDispatcherPort {
  private constructor(private readonly pipeline: AppPulledUsagePipeline) {
    super();
  }

  static create(pipeline: AppPulledUsagePipeline): AppPulledUsageEventDispatcher {
    return new AppPulledUsageEventDispatcher(pipeline);
  }

  async recordPulledUsage(input: PulledUsageRecordCommand): Promise<void> {
    await this.pipeline.recordPulledUsage(input);
  }
}

class AppIngestionPullRunPort extends IngestionPullRunPort {
  private constructor(
    private readonly worker: IngestionPullWorkerService,
    private readonly pulledUsage: PulledUsageDispatcherPort,
  ) {
    super();
  }

  static create(options: {
    worker: IngestionPullWorkerService;
    pulledUsage: PulledUsageDispatcherPort;
  }): AppIngestionPullRunPort {
    return new AppIngestionPullRunPort(options.worker, options.pulledUsage);
  }

  run(input: { sourceId: string; cursor: string | null }) {
    return this.worker.run({ ...input, pulledUsage: this.pulledUsage });
  }
}

class AppIngestionPullOutcomePort extends IngestionPullOutcomePort {
  private constructor(private readonly pipeline: AppIngestionPullPipeline) {
    super();
  }

  static create(pipeline: AppIngestionPullPipeline): AppIngestionPullOutcomePort {
    return new AppIngestionPullOutcomePort(pipeline);
  }

  async completed(input: IngestionPullCompletedCommand): Promise<void> {
    await this.pipeline.recordRunCompleted(input);
  }

  async failed(input: IngestionPullFailedCommand): Promise<void> {
    await this.pipeline.recordRunFailed(input);
  }
}

class AppIngestionPullMetricsPort extends IngestionPullMetricsPort {
  private constructor(private readonly metrics: GovernanceIngestionPullMetricsPort) {
    super();
  }

  static create(metrics: GovernanceIngestionPullMetricsPort): AppIngestionPullMetricsPort {
    return new AppIngestionPullMetricsPort(metrics);
  }

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.metrics.count(outcome);
  }

  observeDuration(durationMs: number): void {
    this.metrics.observeDuration(durationMs);
  }
}

class UtcIngestionPullSchedulePort extends IngestionPullSchedulePort {
  private constructor(private readonly schedule: GovernanceIngestionPullSchedulePort) {
    super();
  }

  static create(schedule: GovernanceIngestionPullSchedulePort): UtcIngestionPullSchedulePort {
    return new UtcIngestionPullSchedulePort(schedule);
  }

  nextRunAt(input: { cron: string; after: number }): number {
    return this.schedule.nextRunAt(input);
  }
}

class AppIngestionPullTenantPort extends IngestionPullTenantPort {
  private constructor(private readonly projects: GovernanceInternalProjectPort) {
    super();
  }

  static create(projects: GovernanceInternalProjectPort): AppIngestionPullTenantPort {
    return new AppIngestionPullTenantPort(projects);
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

class AppIngestionPullLifecycleCommandPort extends IngestionPullLifecycleCommandPort {
  private constructor(private readonly pipeline: AppIngestionPullPipeline) {
    super();
  }

  static create(pipeline: AppIngestionPullPipeline): AppIngestionPullLifecycleCommandPort {
    return new AppIngestionPullLifecycleCommandPort(pipeline);
  }

  async configure(input: IngestionPullConfigureCommand): Promise<void> {
    await this.pipeline.configure(input);
  }

  async disable(input: IngestionPullDisableCommand): Promise<void> {
    await this.pipeline.disable(input);
  }
}

class AppIngestionPullDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class AppPipelineGovernanceEventingPort extends GovernanceEventingPort {
  private constructor(
    private readonly ingestionPull: AppIngestionPullPipeline,
    private readonly pulledUsage: AppPulledUsagePipeline,
  ) {
    super();
  }

  static create(
    ingestionPull: AppIngestionPullPipeline,
    pulledUsage: AppPulledUsagePipeline,
  ): AppPipelineGovernanceEventingPort {
    return new AppPipelineGovernanceEventingPort(ingestionPull, pulledUsage);
  }

  async configureIngestion(input: ConfigureIngestionPullCommand): Promise<void> {
    await this.ingestionPull.configure({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? Date.now(),
      ...input.data,
    });
  }

  async disableIngestion(input: DisableIngestionPullCommand): Promise<void> {
    await this.ingestionPull.disable({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? Date.now(),
      ...input.data,
    });
  }

  async recordIngestionRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void> {
    await this.ingestionPull.recordRunCompleted({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? Date.now(),
      ...input.data,
    });
  }

  async recordIngestionRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void> {
    await this.ingestionPull.recordRunFailed({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? Date.now(),
      ...input.data,
    });
  }

  async recordPulledUsage(input: RecordPulledUsageCommand): Promise<void> {
    await this.pulledUsage.recordPulledUsage({
      tenantId: input.tenantId,
      occurredAt: input.occurredAt ?? Date.now(),
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

  static noopGovernancePort(): GovernanceEventingPort {
    return AppPipelineGovernanceEventingPort.create(
      this.noopIngestionPullPipeline(),
      this.noopPulledUsagePipeline(),
    );
  }

  static governancePort(
    ingestionPull: AppIngestionPullPipeline,
    pulledUsage: AppPulledUsagePipeline,
  ): GovernanceEventingPort {
    return AppPipelineGovernanceEventingPort.create(ingestionPull, pulledUsage);
  }

  register(): AppGovernanceEventingInstallation {
    const pulledUsagePipeline = this.eventSourcing.register(
      PulledUsageEventingAdapter.create({
        ledger: this.runtime.execution.ledger
          ? PulledUsageLedgerProcess.create(
              AppPulledUsageLedgerPort.create(this.runtime.execution.ledger),
            )
          : undefined,
      }).build(),
    );
    const pulledUsageCommands = mapCommands(pulledUsagePipeline.commands);
    const pulledUsage = AppPulledUsagePipeline.create(pulledUsageCommands.recordPulledUsage);
    const ingestionPull = AppIngestionPullPipeline.deferred();
    const execution = IngestionPullService.create(
      AppIngestionPullRunPort.create({
        worker: this.runtime.execution.worker,
        pulledUsage: AppPulledUsageEventDispatcher.create(pulledUsage),
      }),
      AppIngestionPullOutcomePort.create(ingestionPull),
      AppIngestionPullMetricsPort.create(this.runtime.execution.metrics),
    );
    const ingestionPullPipeline = this.eventSourcing.register(
      IngestionPullEventingAdapter.create({
        runStatusStore: PostgresIngestionPullRunProjectionAdapter.create(
          this.runtime.lifecycle.database,
        ).build(),
        process: IngestionPullProcess.create({
          schedule: UtcIngestionPullSchedulePort.create(this.runtime.lifecycle.schedule),
          execution,
        }),
      }).build(),
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
    return PostgresIngestionPullLifecycleAdapter.create({
      database: this.runtime.lifecycle.database,
      tenant: AppIngestionPullTenantPort.create(this.runtime.lifecycle.projects),
      commands: AppIngestionPullLifecycleCommandPort.create(pipeline),
      diagnostics: new AppIngestionPullDiagnosticsPort(),
    }).build();
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
