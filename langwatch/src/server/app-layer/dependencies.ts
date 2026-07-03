import type Stripe from "stripe";
import type { NotificationService } from "../../../ee/billing/notifications/notification.service";
import type { UsageLimitService } from "../../../ee/billing/notifications/usage-limit.service";
import type { NurturingService } from "../../../ee/billing/nurturing/nurturing.service";
import type { WebhookService } from "../../../ee/billing/services/webhookService";
import type { StorageMeterService } from "../data-retention/metering/storageMeter.service";
import type { PinnedTraceService } from "../data-retention/pinning/pinnedTrace.service";
import type { DataRetentionPolicyService } from "../data-retention/policy/dataRetentionPolicy.service";
import type { RetentionPolicyCache } from "../data-retention/retentionPolicyCache";
import type { RetroactiveUpdateService } from "../data-retention/retroactive/retroactiveUpdate.service";
import type { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import type { ExperimentService } from "../experiments/experiment.service";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { AppConfig } from "./config";
import type { DspyStepService } from "./dspy-steps/dspy-step.service";
import type { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "./evaluations/evaluation-run.service";
import type { EventExplorerService } from "./ops/event-explorer.service";
import type { OpsMetricsCollector } from "./ops/metrics-collector";
import type { QueueService } from "./ops/queue.service";
import type { ReplayService } from "./ops/replay.service";
import type { OrganizationService } from "./organizations/organization.service";
import type { PresenceService } from "./presence/presence.service";
import type { ProjectService } from "./projects/project.service";
import type { ShareService } from "./share/share.service";
import type { SimulationRunService } from "./simulations/simulation-run.service";
import type { PlanProvider } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { SuiteRunService } from "./suites/suite-run.service";
import type { LogRecordStorageService } from "./traces/log-record-storage.service";
import type { LogRequestCollectionService } from "./traces/log-request-collection.service";
import type { MetricRecordStorageService } from "./traces/metric-record-storage.service";
import type { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { TraceListService } from "./traces/trace-list.service";
import type { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { EmailSuppressionService } from "./triggers/emailSuppression.service";
import type { TriggerService } from "./triggers/trigger.service";
import type {
  TestFireTriggerInput,
  TestFireResult,
} from "./triggers/trigger-template.service";
import type { UsageService } from "./usage/usage.service";

export interface DataRetentionDependencies {
  policy: DataRetentionPolicyService;
  pinning: PinnedTraceService;
  retroactive: RetroactiveUpdateService;
  metering: StorageMeterService;
}

export interface OpsDependencies {
  queues: QueueService;
  eventExplorer: EventExplorerService;
  replay: ReplayService;
  metricsCollector: OpsMetricsCollector | null;
}

export interface AppDependencies {
  config: AppConfig;

  broadcast: BroadcastService;
  presence: PresenceService;

  traces: {
    summary: TraceSummaryService;
    list: TraceListService;
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
  dspySteps: {
    steps: DspyStepService;
  };
  simulations: {
    runs: SimulationRunService;
  };
  suiteRuns: {
    runs: SuiteRunService;
  };
  experiments: ExperimentService;
  triggers: TriggerService;
  /** Wraps `testFireTrigger(deps, input)` with the composition-time
   *  `{baseHost, notifier}` bag already bound — the router only needs
   *  to pass the per-call input. */
  triggerTemplates: {
    testFire: (input: TestFireTriggerInput) => Promise<TestFireResult>;
  };
  emailSuppressions: EmailSuppressionService;
  organizations: OrganizationService;
  projects: ProjectService;
  tokenizer: TokenizerService;
  usage: UsageService;
  planProvider: PlanProvider;
  subscription?: SubscriptionService;
  /** Only present in SaaS — dispatches Stripe webhook events. */
  webhookService?: WebhookService;
  /** Only present in SaaS — Stripe client used by the webhook transport to
   *  verify signatures before handing events to the service. */
  stripeClient?: Stripe;
  notifications: NotificationService;
  nurturing?: NurturingService;
  usageLimits: UsageLimitService;
  retentionPolicyCache: RetentionPolicyCache;
  dataRetention: DataRetentionDependencies;
  share: ShareService;
  commands: AppCommands;
  ops?: OpsDependencies;

  /** Internal — keeps EventSourcing infrastructure alive for GC. */
  _eventSourcing?: EventSourcing;

  /** Internal — resources to gracefully close on shutdown. */
  _gracefulCloseables?: Array<{ name: string; close: () => Promise<void> }>;
}
