import type { TriggerSummary } from "@langwatch/automation-contract";
import type { AutomationClock } from "../app/automation.members.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";

/** How long a project's active-automation list is reused before re-reading. */
const ACTIVE_CACHE_TTL_MS = 60_000;

/**
 * Cache one project's active automations for 1 min: the read is on the hot path
 * twice per trace, and staleness is the deliberate cost of avoiding queries.
 */
export class ActiveTriggerCacheService {
  private readonly entries = new Map<string, { expires: number; value: TriggerSummary[] }>();

  static create(input: {
    triggers: TriggerRepository;
    clock: AutomationClock;
  }): ActiveTriggerCacheService {
    return new ActiveTriggerCacheService(input.triggers, input.clock);
  }

  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly clock: AutomationClock,
  ) {}

  /** Automations whose subject is a custom graph. Never a report. */
  async getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    const triggers = await this.getAll(projectId);

    return triggers.filter(
      (trigger) => trigger.customGraphId !== null && trigger.triggerKind !== "REPORT",
    );
  }

  /** Automations whose subject is a trace. Never a report. */
  async getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    const triggers = await this.getAll(projectId);

    return triggers.filter((trigger) => !trigger.customGraphId && trigger.triggerKind !== "REPORT");
  }

  /** Drops this process's window for one project after a write. */
  invalidate(projectId: string): void {
    this.entries.delete(projectId);
  }

  private async getAll(projectId: string): Promise<TriggerSummary[]> {
    const cached = this.entries.get(projectId);
    if (cached && cached.expires > this.clock.now().epochMilliseconds) {
      return cached.value;
    }

    const value = await this.triggers.findActiveForProject(projectId);
    this.entries.set(projectId, {
      expires: this.clock.now().epochMilliseconds + ACTIVE_CACHE_TTL_MS,
      value,
    });

    return value;
  }
}
