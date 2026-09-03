import type { TriggerSummary } from "@langwatch/automation-contract";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import type { TriggerRepository } from "../repositories/trigger.repository";

/** How long a project's active-automation list is reused before re-reading. */
const ACTIVE_CACHE_TTL_MS = 60_000;

/**
 * One project's active automations, split the two ways the pipelines ask for
 * them, held for a minute.
 *
 * The read is on the hot path twice over: every trace that lands asks whether
 * this project has trace automations, and every trace that lands asks again
 * whether it has graph ones. Without the window that is two queries per span
 * batch per project.
 *
 * A minute of staleness is the deliberate cost. A newly saved automation may
 * not fire for up to a minute in a process that has already read the project;
 * the writer calls `invalidate` so its OWN process sees the change at once,
 * and every other process in the fleet waits out its window. That was already
 * true of a multi-pod deployment and is why the window is short enough to be
 * unremarkable and long enough to matter.
 *
 * It lives here rather than inside the service that used to hold it because
 * two callers now need the same answer with the same window: the full
 * `AutomationService`, and the graph-only activity adapter a background process
 * composes. Two caches over one table would give one process two different
 * ideas of which automations are live.
 */
export class ActiveTriggerCacheService {
  private readonly entries = new Map<string, { expires: number; value: TriggerSummary[] }>();

  static create(input: {
    triggers: TriggerRepository;
    clock: AutomationClockPort;
  }): ActiveTriggerCacheService {
    return new ActiveTriggerCacheService(input.triggers, input.clock);
  }

  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly clock: AutomationClockPort,
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
    if (cached && cached.expires > this.clock.now().getTime()) {
      return cached.value;
    }

    const value = await this.triggers.findActiveForProject(projectId);
    this.entries.set(projectId, {
      expires: this.clock.now().getTime() + ACTIVE_CACHE_TTL_MS,
      value,
    });

    return value;
  }
}
