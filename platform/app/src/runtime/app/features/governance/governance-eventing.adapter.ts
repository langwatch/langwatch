// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
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
import type { EventSourcing } from "@langwatch/eventing";
import { mapCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

const logger = createLogger("langwatch:enterprise:governance-eventing");

type IngestionPullCommands = {
  configure(
    input: Parameters<IngestionPullLifecycleCommandPort["configure"]>[0],
  ): Promise<unknown>;
  disable(
    input: Parameters<IngestionPullLifecycleCommandPort["disable"]>[0],
  ): Promise<unknown>;
  recordRunCompleted(
    input: Parameters<IngestionPullOutcomePort["completed"]>[0],
  ): Promise<unknown>;
  recordRunFailed(
    input: Parameters<IngestionPullOutcomePort["failed"]>[0],
  ): Promise<unknown>;
};

type PulledUsageCommands = {
  recordPulledUsage(
    input: Parameters<PulledUsageDispatcherPort["recordPulledUsage"]>[0],
  ): Promise<unknown>;
};

export type AppGovernanceEventingCommands = {
  ingestionPull: IngestionPullCommands;
  pulledUsage: PulledUsageCommands;
};

export type AppGovernanceEventingAdapterOptions = {
  eventSourcing: EventSourcing;
  database: IngestionPullLifecycleDatabase;
  runsWorkers: boolean;
  worker: IngestionPullWorkerService;
  resolveTenantId(organizationId: string): Promise<string>;
  pulledUsageLedger?: GatewayBudgetClickHouseRepository;
};

class AppPulledUsageLedgerPort extends PulledUsageLedgerPort {
  private constructor(
    private readonly repository: GatewayBudgetClickHouseRepository,
  ) {
    super();
  }

  static create(
    repository: GatewayBudgetClickHouseRepository,
  ): AppPulledUsageLedgerPort {
    return new AppPulledUsageLedgerPort(repository);
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

class AppPulledUsageDispatcherPort extends PulledUsageDispatcherPort {
  private constructor(private readonly commands: PulledUsageCommands) {
    super();
  }

  static create(
    commands: PulledUsageCommands,
  ): AppPulledUsageDispatcherPort {
    return new AppPulledUsageDispatcherPort(commands);
  }

  async recordPulledUsage(
    input: Parameters<PulledUsageDispatcherPort["recordPulledUsage"]>[0],
  ): Promise<void> {
    await this.commands.recordPulledUsage(input);
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
  private commands: IngestionPullCommands | undefined;

  connect(commands: IngestionPullCommands): void {
    this.commands = commands;
  }

  async completed(
    input: Parameters<IngestionPullOutcomePort["completed"]>[0],
  ): Promise<void> {
    await this.requireCommands().recordRunCompleted(input);
  }

  async failed(
    input: Parameters<IngestionPullOutcomePort["failed"]>[0],
  ): Promise<void> {
    await this.requireCommands().recordRunFailed(input);
  }

  private requireCommands(): IngestionPullCommands {
    if (!this.commands) {
      throw new Error(
        "Ingestion pull outcome commands used before pipeline registration",
      );
    }
    return this.commands;
  }
}

class AppIngestionPullMetricsPort extends IngestionPullMetricsPort {
  count(
    outcome: "completed" | "failed_retryable" | "failed_final",
  ): void {
    incrementIngestionPullTotal({ outcome });
  }

  observeDuration(durationMs: number): void {
    observeIngestionPullDuration({ durationMs });
  }
}

class UtcIngestionPullSchedulePort extends IngestionPullSchedulePort {
  nextRunAt(input: { cron: string; after: number }): number {
    return computeNextRunAt({
      cron: input.cron,
      timezone: "UTC",
      after: new Date(input.after),
    }).getTime();
  }
}

class AppIngestionPullTenantPort extends IngestionPullTenantPort {
  private constructor(
    private readonly resolve: (organizationId: string) => Promise<string>,
  ) {
    super();
  }

  static create(
    resolve: (organizationId: string) => Promise<string>,
  ): AppIngestionPullTenantPort {
    return new AppIngestionPullTenantPort(resolve);
  }

  resolveTenantId(organizationId: string): Promise<string> {
    return this.resolve(organizationId);
  }
}

class AppIngestionPullLifecycleCommandPort extends IngestionPullLifecycleCommandPort {
  private constructor(private readonly commands: IngestionPullCommands) {
    super();
  }

  static create(
    commands: IngestionPullCommands,
  ): AppIngestionPullLifecycleCommandPort {
    return new AppIngestionPullLifecycleCommandPort(commands);
  }

  async configure(
    input: Parameters<IngestionPullLifecycleCommandPort["configure"]>[0],
  ): Promise<void> {
    await this.commands.configure(input);
  }

  async disable(
    input: Parameters<IngestionPullLifecycleCommandPort["disable"]>[0],
  ): Promise<void> {
    await this.commands.disable(input);
  }
}

class AppIngestionPullDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

export class AppGovernanceEventingAdapter {
  private constructor(
    private readonly options: AppGovernanceEventingAdapterOptions,
  ) {}

  static create(
    options: AppGovernanceEventingAdapterOptions,
  ): AppGovernanceEventingAdapter {
    return new AppGovernanceEventingAdapter(options);
  }

  static noopCommands(): AppGovernanceEventingCommands {
    const noop = async () => undefined;
    return {
      ingestionPull: {
        configure: noop,
        disable: noop,
        recordRunCompleted: noop,
        recordRunFailed: noop,
      },
      pulledUsage: { recordPulledUsage: noop },
    };
  }

  register(): {
    commands: AppGovernanceEventingCommands;
    lifecycle: IngestionPullLifecycleService;
  } {
    const pulledUsagePipeline = this.options.eventSourcing.register(
      PulledUsageEventingAdapter.create({
        ledger: this.options.pulledUsageLedger
          ? PulledUsageLedgerProcess.create(
              AppPulledUsageLedgerPort.create(
                this.options.pulledUsageLedger,
              ),
            )
          : undefined,
      }).build(),
    );
    const pulledUsage = mapCommands(pulledUsagePipeline.commands);
    const outcomes = new AppIngestionPullOutcomePort();
    const execution = IngestionPullService.create(
      AppIngestionPullRunPort.create({
        worker: this.options.worker,
        pulledUsage: AppPulledUsageDispatcherPort.create(pulledUsage),
      }),
      outcomes,
      new AppIngestionPullMetricsPort(),
    );
    const ingestionPullPipeline = this.options.eventSourcing.register(
      IngestionPullEventingAdapter.create({
        runStatusStore: PostgresIngestionPullRunProjectionAdapter.create(
          this.options.database,
        ).build(),
        process: IngestionPullProcess.create({
          schedule: new UtcIngestionPullSchedulePort(),
          execution,
        }),
      }).build(),
    );
    const ingestionPull = mapCommands(ingestionPullPipeline.commands);
    outcomes.connect(ingestionPull);
    const lifecycle = this.lifecycle(ingestionPull);
    this.reconcile(lifecycle);
    return { commands: { ingestionPull, pulledUsage }, lifecycle };
  }

  private lifecycle(
    commands: IngestionPullCommands,
  ): IngestionPullLifecycleService {
    return PostgresIngestionPullLifecycleAdapter.create({
      database: this.options.database,
      tenant: AppIngestionPullTenantPort.create(this.options.resolveTenantId),
      commands: AppIngestionPullLifecycleCommandPort.create(commands),
      diagnostics: new AppIngestionPullDiagnosticsPort(),
    }).build();
  }

  private reconcile(lifecycle: IngestionPullLifecycleService): void {
    if (!this.options.runsWorkers) return;
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
