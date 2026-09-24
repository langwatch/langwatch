import type { AnalyticsApi, AnalyticsService } from "@langwatch/analytics-contract";
import type {
  AutomationPersistCapBreach,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

import type {
  AutomationDispatchError,
  AutomationGraphNotifier,
  AutomationLogger,
  AutomationSlackBotTokenDecryptor,
  AutomationClock,
} from "../app/automation.members.ts";
import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import type { AutomationRunaway } from "../repositories/automation-runaway.repository.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { AutomationRunawaySignals } from "./automation-runaway-signals.service.ts";
import { GraphTriggerEvaluatorService } from "./graph-trigger-evaluator.service.ts";
import { GraphTriggerHeartbeatService } from "./graph-trigger-heartbeat.service.ts";
import { RunawayContainmentService } from "./runaway-containment.service.ts";

/** Private graph-alert collaborator, assembled once with Automation's service. */
export class AutomationGraphService {
  private constructor(
    private readonly evaluator: GraphTriggerEvaluatorService,
    private readonly heartbeat: GraphTriggerHeartbeatService,
    private readonly containment: RunawayContainmentService,
  ) {}

  static create(input: {
    triggers: TriggerRepository;
    customGraphs: CustomGraphRepository;
    projects: ProjectApi;
    analytics: AnalyticsService & Pick<AnalyticsApi, "findLastOccurredAt">;
    triggerSent: GraphTriggerSentRepository;
    notifier: AutomationGraphNotifier;
    logger: AutomationLogger;
    slackTokens: AutomationSlackBotTokenDecryptor;
    dispatchErrors: AutomationDispatchError;
    runaway: AutomationRunaway & AutomationRunawayNotice & AutomationRunawaySignals;
    clock: AutomationClock;
    baseHost: string;
  }): AutomationGraphService {
    return new AutomationGraphService(
      GraphTriggerEvaluatorService.create({
        triggers: input.triggers,
        customGraphs: input.customGraphs,
        projects: input.projects,
        analytics: input.analytics,
        triggerSent: input.triggerSent,
        notifier: input.notifier,
        logger: input.logger,
        slackTokens: input.slackTokens,
        dispatchErrors: input.dispatchErrors,
        clock: input.clock,
        baseHost: input.baseHost,
      }),
      GraphTriggerHeartbeatService.create({
        triggers: input.triggers,
        triggerSent: input.triggerSent,
        analytics: input.analytics,
        logger: input.logger,
      }),
      RunawayContainmentService.create({
        runaway: input.runaway,
        clock: input.clock,
        triggers: input.triggers,
      }),
    );
  }

  evaluate(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return this.evaluator.evaluate(input);
  }

  decideHeartbeat(input: { now: Instant }): Promise<GraphTriggerSweepCandidate[]> {
    return this.heartbeat.decide(input);
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.containment.handle(input);
  }
}
