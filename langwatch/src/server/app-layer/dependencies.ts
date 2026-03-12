import type { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { AppConfig } from "./config";
import type { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "./evaluations/evaluation-run.service";
import type { OrganizationService } from "./organizations/organization.service";
import type { ProjectService } from "./projects/project.service";
import type { LogRecordStorageService } from "./traces/log-record-storage.service";
import type { MetricRecordStorageService } from "./traces/metric-record-storage.service";
import type { SimulationRunService } from "./simulations/simulation-run.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { LogRequestCollectionService } from "./traces/log-request-collection.service";
import type { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import type { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { PlanProvider } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { NotificationService } from "../../../ee/billing/notifications/notification.service";
import type { UsageLimitService } from "../../../ee/billing/notifications/usage-limit.service";
import type { UsageService } from "./usage/usage.service";

export interface AppDependencies {
  config: AppConfig;

  broadcast: BroadcastService;

  traces: {
    summary: TraceSummaryService;
    spans: SpanStorageService;
    logRecords: LogRecordStorageService;
    metricRecords: MetricRecordStorageService;
    collection: TraceRequestCollectionService;
    logCollection: LogRequestCollectionService;
    metricCollection: MetricRequestCollectionService;
  };
  evaluations: {
    runs: EvaluationRunService;
    execution: EvaluationExecutionService;
  };
  simulations: {
    runs: SimulationRunService;
  };
  organizations: OrganizationService;
  projects: ProjectService;
  tokenizer: TokenizerService;
  usage: UsageService;
  planProvider: PlanProvider;
  subscription?: SubscriptionService;
  notifications: NotificationService;
  usageLimits: UsageLimitService;
  commands: AppCommands;

  /** Internal — keeps EventSourcing infrastructure alive for GC. */
  _eventSourcing?: EventSourcing;

  /** Internal — resources to gracefully close on shutdown. */
  _gracefulCloseables?: Array<{ name: string; close: () => Promise<void> }>;
}
