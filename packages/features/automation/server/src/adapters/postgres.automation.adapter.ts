import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AutomationService } from "../services/automation.service.ts";
import type { AutomationService as AutomationCapability } from "@langwatch/automation-contract";
import type { UnsubscribeTokenVerifierPort } from "../ports/unsubscribe-token.port.ts";
import type { AutomationClockPort } from "../ports/automation-clock.port.ts";
import type { ScheduledJobStorePort } from "../ports/scheduled-jobs.port.ts";
import type { SchedulerWakePort } from "../ports/scheduler-wake.port.ts";
import { ReportScheduleService } from "../services/report-schedule.service.ts";
import { AutomationGraphService } from "../services/trigger-graph.service.ts";
import { AutomationTemplateService } from "../services/automation-template.service.ts";
import { PrismaCustomGraphRepository } from "../repositories/prisma/prisma.custom-graph.repository.ts";
import { PrismaEmailSuppressionNameRepository } from "../repositories/prisma/prisma.email-suppression-name.repository.ts";
import { PrismaEmailSuppressionRepository } from "../repositories/prisma/prisma.email-suppression.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import { PrismaTriggerFireHistoryRepository } from "../repositories/prisma/prisma.trigger-fire-history.repository.ts";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository.ts";
import { PrismaWebhookDeliveryRepository } from "../repositories/prisma/prisma.webhook-delivery.repository.ts";
import type {
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationSlackBotTokenDecryptorPort,
  AutomationDispatchErrorPort,
} from "../ports/automation-graph.port.ts";
import type { AutomationRunawayPort } from "../ports/automation-runaway.port.ts";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { AutomationTestFirePort } from "../ports/automation-test-fire.port.ts";
import type { AutomationPersistCapService } from "../services/persist-cap.service.ts";

/** Canonical process binding. The app supplies its already-created database
 * capability; this adapter never reaches for a global Prisma client. */
export class PostgresAutomationAdapter {
  private constructor(
    private readonly input: {
      database: PrismaClient;
      verifier: UnsubscribeTokenVerifierPort;
      jobs: ScheduledJobStorePort;
      clock: AutomationClockPort;
      wake: SchedulerWakePort;
      projects: ProjectService;
      analytics: AnalyticsService;
      notifier: AutomationGraphNotifierPort;
      baseHost: string;
      logger: AutomationLoggerPort;
      slackTokens: AutomationSlackBotTokenDecryptorPort;
      dispatchErrors: AutomationDispatchErrorPort;
      heartbeat: AutomationHeartbeatPort;
      runaway: AutomationRunawayPort;
      testFire: AutomationTestFirePort;
      persistCaps: AutomationPersistCapService;
    },
  ) {}

  static create(input: {
    database: PrismaClient;
    verifier: UnsubscribeTokenVerifierPort;
    jobs: ScheduledJobStorePort;
    clock: AutomationClockPort;
    wake: SchedulerWakePort;
    projects: ProjectService;
    analytics: AnalyticsService;
    notifier: AutomationGraphNotifierPort;
    baseHost: string;
    logger: AutomationLoggerPort;
    slackTokens: AutomationSlackBotTokenDecryptorPort;
    dispatchErrors: AutomationDispatchErrorPort;
    heartbeat: AutomationHeartbeatPort;
    runaway: AutomationRunawayPort;
    testFire: AutomationTestFirePort;
    persistCaps: AutomationPersistCapService;
  }): PostgresAutomationAdapter {
    return new PostgresAutomationAdapter(input);
  }

  build(): AutomationCapability {
    const { verifier } = this.input;
    const database = this.input.database;
    const triggerRepository = PrismaTriggerRepository.create(database, this.input.clock);
    const repositories = {
      triggers: triggerRepository,
      history: PrismaTriggerFireHistoryRepository.create(database),
      suppressions: PrismaEmailSuppressionRepository.create(database),
      names: PrismaEmailSuppressionNameRepository.create(database),
      verifier,
      reportSchedules: ReportScheduleService.create({
        jobs: this.input.jobs,
        clock: this.input.clock,
        wake: this.input.wake,
        triggers: triggerRepository,
      }),
      clock: this.input.clock,
      customGraphs: PrismaCustomGraphRepository.create(database),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(database),
    };
    const graph = AutomationGraphService.create({
      triggers: repositories.triggers,
      customGraphs: repositories.customGraphs,
      projects: this.input.projects,
      analytics: this.input.analytics,
      notifier: this.input.notifier,
      triggerSent: PrismaGraphTriggerSentRepository.create(database),
      logger: this.input.logger,
      slackTokens: this.input.slackTokens,
      dispatchErrors: this.input.dispatchErrors,
      heartbeat: this.input.heartbeat,
      runaway: this.input.runaway,
      clock: this.input.clock,
      baseHost: this.input.baseHost,
    });
    const templates = AutomationTemplateService.create({
      baseHost: this.input.baseHost,
      delivery: this.input.testFire,
    });
    return AutomationService.create({
      ...repositories,
      graph,
      templates,
      persistCaps: this.input.persistCaps,
    });
  }
}
