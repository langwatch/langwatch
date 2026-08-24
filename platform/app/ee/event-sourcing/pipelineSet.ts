import {
  IngestionPullEventingAdapter,
  IngestionPullOutcomePort,
  IngestionPullProcessService,
  IngestionPullRunPort,
  IngestionPullService,
  PulledUsageEventingAdapter,
} from "@langwatch/enterprise-governance-server";
import type { EventSourcing } from "@langwatch/eventing";
import { mapCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { AppIngestionPullMetricsPort } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/process-manager/ingestionPullEffects";
import { UtcIngestionPullSchedulePort } from "@ee/event-sourcing/pipelines/ingestion-pull-processing";
import {
  AppPulledUsageLedgerService,
  type AppPulledUsageLedgerConfig,
} from "@ee/governance/process-manager/pulledUsageLedger.process";
import { reconcileIngestionPullProcesses } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import {
  type PulledUsageDispatcher,
  runIngestionPull,
} from "@ee/governance/services/pullers/pullerWorker";
import { PrismaIngestionPullRunProjectionRepository } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";

const logger = createLogger("langwatch:enterprise:governance-runtime");

export interface EnterprisePipelineSetConfig {
  prisma: PrismaClient;
  runsWorkers: boolean;
  pulledUsageLedger?: AppPulledUsageLedgerConfig;
}

type EnterprisePipelineRuntimeDeps = EnterprisePipelineSetConfig & {
  eventSourcing: EventSourcing;
};

type IngestionPullOutcomeCommands = {
  recordRunCompleted(
    input: Parameters<IngestionPullOutcomePort["completed"]>[0],
  ): Promise<unknown>;
  recordRunFailed(
    input: Parameters<IngestionPullOutcomePort["failed"]>[0],
  ): Promise<unknown>;
};

class AppIngestionPullRunPort extends IngestionPullRunPort {
  private constructor(private readonly pulledUsage: PulledUsageDispatcher) {
    super();
  }

  static create(pulledUsage: PulledUsageDispatcher): AppIngestionPullRunPort {
    return new AppIngestionPullRunPort(pulledUsage);
  }

  run(input: { sourceId: string; cursor: string | null }) {
    return runIngestionPull({ ...input, pulledUsage: this.pulledUsage });
  }
}

class AppIngestionPullOutcomePort extends IngestionPullOutcomePort {
  private commands: IngestionPullOutcomeCommands | undefined;

  static create(): AppIngestionPullOutcomePort {
    return new AppIngestionPullOutcomePort();
  }

  connect(commands: IngestionPullOutcomeCommands): void {
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

  private requireCommands(): IngestionPullOutcomeCommands {
    if (!this.commands) {
      throw new Error(
        "Ingestion pull outcome commands used before the pipeline was registered",
      );
    }
    return this.commands;
  }
}

export class AppGovernancePipelineRuntime {
  private constructor(private readonly deps: EnterprisePipelineRuntimeDeps) {}

  static create(
    deps: EnterprisePipelineRuntimeDeps,
  ): AppGovernancePipelineRuntime {
    return new AppGovernancePipelineRuntime(deps);
  }

  static noopCommands(): EnterprisePipelineCommands {
    const noop = async () => undefined;
    return {
      ingestionPull: {
        configure: noop,
        disable: noop,
        recordRunCompleted: noop,
        recordRunFailed: noop,
      },
      pulledUsage: { recordPulledUsage: noop },
    } satisfies EnterprisePipelineCommands;
  }

  register() {
    const pulledUsage = this.registerPulledUsage();
    const ingestionPull = this.registerIngestionPull({
      recordPulledUsage: pulledUsage.commands.recordPulledUsage,
    });
    return {
      commands: {
        ingestionPull: ingestionPull.commands,
        pulledUsage: pulledUsage.commands,
      },
    };
  }

  private registerPulledUsage() {
    const repository = this.deps.pulledUsageLedger?.budgetCHRepository;
    const ledger = repository
      ? AppPulledUsageLedgerService.create(repository).process()
      : undefined;
    const pipeline = this.deps.eventSourcing.register(
      PulledUsageEventingAdapter.create({ ledger }).build(),
    );
    return { commands: mapCommands(pipeline.commands) };
  }

  private registerIngestionPull(pulledUsage: PulledUsageDispatcher) {
    const outcomes = AppIngestionPullOutcomePort.create();
    const execution = IngestionPullService.create(
      AppIngestionPullRunPort.create(pulledUsage),
      outcomes,
      AppIngestionPullMetricsPort.create(),
    );
    const process = IngestionPullProcessService.create({
      schedule: UtcIngestionPullSchedulePort.create(),
      execution,
    });
    const pipeline = this.deps.eventSourcing.register(
      IngestionPullEventingAdapter.create({
        runStatusStore: new PrismaIngestionPullRunProjectionRepository(
          this.deps.prisma,
        ),
        process,
      }).build(),
    );
    const commands = mapCommands(pipeline.commands);
    outcomes.connect(commands);
    this.reconcile(commands);
    return { commands };
  }

  private reconcile(
    commands: EnterprisePipelineCommands["ingestionPull"],
  ): void {
    if (!this.deps.runsWorkers) return;
    void reconcileIngestionPullProcesses({
      prisma: this.deps.prisma,
      commands,
    })
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

export type EnterprisePipelineCommands = ReturnType<
  AppGovernancePipelineRuntime["register"]
>["commands"];
