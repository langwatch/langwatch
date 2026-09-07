import type {
  AutomationPersistCapBreach,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationSlackBotTokenDecryptorPort,
} from "../ports/automation-graph.port.ts";
import { AutomationRunawayPort } from "../ports/automation-runaway.port.ts";
import { AutomationClockPort } from "../ports/automation-clock.port.ts";
import { GraphTriggerEvaluatorService } from "./graph-trigger-evaluator.service.ts";
import { GraphTriggerHeartbeatService } from "./graph-trigger-heartbeat.service.ts";
import { RunawayContainmentService } from "./runaway-containment.service.ts";
import type { Instant } from "@langwatch/time";

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
    projects: ProjectService;
    analytics: AnalyticsService;
    triggerSent: GraphTriggerSentRepository;
    notifier: AutomationGraphNotifierPort;
    logger: AutomationLoggerPort;
    slackTokens: AutomationSlackBotTokenDecryptorPort;
    dispatchErrors: AutomationDispatchErrorPort;
    heartbeat: AutomationHeartbeatPort;
    runaway: AutomationRunawayPort;
    clock: AutomationClockPort;
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
        heartbeat: input.heartbeat,
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

  decideHeartbeat(input: { now: Date }): Promise<GraphTriggerSweepCandidate[]> {
    return this.heartbeat.decide(input);
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.containment.handle(input);
  }
}
