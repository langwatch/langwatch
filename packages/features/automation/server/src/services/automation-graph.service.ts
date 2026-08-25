import type {
  AutomationPersistCapBreach,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "@langwatch/automation-contract";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository";
import type { TriggerRepository } from "../repositories/trigger.repository";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationGraphTelemetryPort,
  AutomationHeartbeatPort,
  AutomationSlackBotTokenDecryptorPort,
} from "../ports/automation-graph.port";
import { AutomationRunawayPort } from "../ports/automation-runaway.port";
import { AutomationClock } from "../ports/automation-clock.port";
import { GraphTriggerEvaluationService } from "./graph-trigger-evaluation.service";
import { GraphTriggerHeartbeatService } from "./graph-trigger-heartbeat.service";
import { RunawayContainmentService } from "./runaway-containment.service";

/** Private graph-alert collaborator, assembled once with Automation's service. */
export class AutomationGraphService {
  private constructor(
    private readonly evaluator: GraphTriggerEvaluationService,
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
    telemetry: AutomationGraphTelemetryPort;
    slackTokens: AutomationSlackBotTokenDecryptorPort;
    dispatchErrors: AutomationDispatchErrorPort;
    heartbeat: AutomationHeartbeatPort;
    runaway: AutomationRunawayPort;
    clock: AutomationClock;
    baseHost: string;
  }): AutomationGraphService {
    return new AutomationGraphService(
      GraphTriggerEvaluationService.create({
        triggers: input.triggers,
        customGraphs: input.customGraphs,
        projects: input.projects,
        analytics: input.analytics,
        triggerSent: input.triggerSent,
        notifier: input.notifier,
        telemetry: input.telemetry,
        slackTokens: input.slackTokens,
        dispatchErrors: input.dispatchErrors,
        clock: input.clock,
        baseHost: input.baseHost,
      }),
      GraphTriggerHeartbeatService.create({
        triggers: input.triggers,
        triggerSent: input.triggerSent,
        resolveClickHouseClient: (projectId) =>
          input.heartbeat.tryResolveClickHouseClient(projectId),
        telemetry: input.telemetry,
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
