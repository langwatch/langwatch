import { BillingApi } from "@langwatch/enterprise-billing-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import {
  UsageApi,
  type UsageApi as UsageApiContract,
  type UsageServerConfig,
  usageConfig,
} from "@langwatch/usage-contract";

import { CountMonthCommand } from "../eventing/usage.commands.ts";
import {
  buildUsagePipeline,
  type UsagePipelineDefinition,
  type UsageSenders,
} from "../eventing/usage.pipeline.ts";
import type { UsageRepositories } from "../repositories/usage.repositories.ts";
import { BillableEventsMeterAppendService } from "../services/billable-events-meter-append.service.ts";
import { TraceMeterAppendService } from "../services/trace-meter-append.service.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

type UsageDependencies = Readonly<{
  entitlement: typeof EntitlementApi;
  billing: typeof BillingApi;
  projects: typeof ProjectApi;
}>;

/** Usage's thin App: it answers by events, so it holds only its pipeline's parts. */
export class UsageModule implements UsageApiContract {
  static readonly contract = UsageApi;
  static readonly dependencies: UsageDependencies = {
    entitlement: EntitlementApi,
    billing: BillingApi,
    projects: ProjectApi,
  };
  static readonly config = usageConfig;

  #senders: UsageSenders | undefined;

  private constructor(
    private readonly build: (send: () => UsageSenders) => UsagePipelineDefinition,
  ) {}

  static create({
    dependencies,
    config,
    repositories,
  }: FeatureSetup<UsageDependencies, never, UsageServerConfig, UsageRepositories>): UsageModule {
    const meter = repositories.billableEvents;
    const counting = UsageCountingService.create({
      meter,
      entitlement: dependencies.entitlement,
      billing: dependencies.billing,
    });
    return new UsageModule((send) =>
      buildUsagePipeline({
        countMonth: CountMonthCommand.create({ counting }),
        meterStores: config.isSaas
          ? {
              billableEvents: BillableEventsMeterAppendService.create({
                meter,
                projects: dependencies.projects,
              }),
              traces: TraceMeterAppendService.create({
                meter: repositories.traces,
                projects: dependencies.projects,
              }),
            }
          : void 0,
        projects: dependencies.projects,
        send,
      }),
    );
  }

  pipeline(): UsagePipelineDefinition {
    return this.build(() => {
      if (!this.#senders) throw new Error("Usage cannot send before its pipeline is registered.");
      return this.#senders;
    });
  }

  connect(commands: EventingCommands<UsagePipelineDefinition>): void {
    this.#senders = {
      countMonth: (data) => commands.countMonth.send(data),
      recordLimitDecision: (data) => commands.recordLimitDecision.send(data),
    };
  }
}
