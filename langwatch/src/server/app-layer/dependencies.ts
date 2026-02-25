import type { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { AppConfig } from "./config";
import type { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "./evaluations/evaluation-run.service";
import type { OrganizationService } from "./organizations/organization.service";
import type { ProjectService } from "./projects/project.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { UsageService } from "./usage/usage.service";

export interface AppDependencies {
  config: AppConfig;

  broadcast: BroadcastService;

  traces: {
    summary: TraceSummaryService;
    spans: SpanStorageService;
  };
  evaluations: {
    runs: EvaluationRunService;
    execution: EvaluationExecutionService;
  };
  organizations: OrganizationService;
  projects: ProjectService;
  tokenizer: TokenizerService;
  usage: UsageService;
  subscription: SubscriptionService;
  commands: AppCommands;

  /** Internal — keeps EventSourcing infrastructure alive for GC. */
  _eventSourcing?: EventSourcing;

  /** Internal — resources to gracefully close on shutdown. */
  _gracefulCloseables?: Array<{ name: string; close: () => Promise<void> }>;
}
