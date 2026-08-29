import type {
  CreateTriggerCommand,
  Trigger,
  TriggerSummary,
  UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { AutomationLoggerPort } from "../../../ports/automation-graph.port";
import type { ReportScheduleTarget } from "../../trigger.repository";
import { TriggerRepository } from "../../trigger.repository";

const unavailable = (): Promise<never> => Promise.reject(new Error("unused test dependency"));

export class HeartbeatTriggerRepository extends TriggerRepository {
  constructor(private readonly triggersByProject: Record<string, TriggerSummary[]>) {
    super();
  }

  findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    return Promise.resolve(this.triggersByProject[projectId] ?? []);
  }

  findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    return unavailable();
  }

  claimSend(): Promise<boolean> {
    return unavailable();
  }

  isSendClaimed(): Promise<boolean> {
    return unavailable();
  }

  findClaimedTraceIds(): Promise<Set<string>> {
    return unavailable();
  }

  updateLastRunAt(): Promise<void> {
    return unavailable();
  }

  findByIdOrThrow(): Promise<Trigger> {
    return unavailable();
  }

  tryFindById(): Promise<Trigger | null> {
    return unavailable();
  }

  findAllByProjectId(): Promise<Trigger[]> {
    return unavailable();
  }

  tryFindByCustomGraphId(): Promise<Trigger | null> {
    return unavailable();
  }

  findByCustomGraphIds(): Promise<Trigger[]> {
    return unavailable();
  }

  create(_input: CreateTriggerCommand): Promise<Trigger> {
    return unavailable();
  }

  update(_input: UpdateTriggerCommand): Promise<Trigger> {
    return unavailable();
  }
}

export class SilentAutomationLogger extends AutomationLoggerPort {
  error(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
}
