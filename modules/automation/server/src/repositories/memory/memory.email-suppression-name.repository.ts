import {
  EmailSuppressionNameRepository,
  type UnsubscribeNames,
} from "../email-suppression-name.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

export class MemoryEmailSuppressionNameRepository extends EmailSuppressionNameRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryEmailSuppressionNameRepository {
    return new MemoryEmailSuppressionNameRepository(memory);
  }

  /**
   * The names an unsubscribe page renders. A project this process has never
   * seen has no name to show, so the read answers nothing rather than an
   * invented one.
   */
  tryLookupNames(input: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null> {
    const projectName = this.memory.projectNames.get(input.projectId);
    if (projectName === undefined) return Promise.resolve(null);
    const trigger =
      input.triggerId === null ? undefined : this.memory.triggers.get(input.triggerId);
    return Promise.resolve({ projectName, triggerName: trigger?.name ?? null });
  }

  findTriggerNames(input: {
    projectId: string;
    triggerIds: string[];
  }): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const triggerId of input.triggerIds) {
      const trigger = this.memory.triggers.get(triggerId);
      if (trigger?.projectId === input.projectId) names.set(trigger.id, trigger.name);
    }
    return Promise.resolve(names);
  }
}
