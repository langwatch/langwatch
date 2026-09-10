import type { EmailSuppression } from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { EmailSuppressionRepository } from "../email-suppression.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

export class MemoryEmailSuppressionRepository extends EmailSuppressionRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryEmailSuppressionRepository {
    return new MemoryEmailSuppressionRepository(memory);
  }

  findAll(input: { projectId: string }): Promise<EmailSuppression[]> {
    return Promise.resolve(
      this.memory.suppressions.filter((row) => row.projectId === input.projectId),
    );
  }

  /**
   * The suppressions that silence one trigger: the project-wide rows and the
   * rows written against that trigger alone.
   */
  findMatching(input: { projectId: string; triggerId: string }): Promise<EmailSuppression[]> {
    return Promise.resolve(
      this.memory.suppressions.filter(
        (row) =>
          row.projectId === input.projectId &&
          (row.triggerId === null || row.triggerId === input.triggerId),
      ),
    );
  }

  create(input: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppression> {
    const row = {
      id: generate("emailsuppression").toString(),
      projectId: input.projectId,
      email: input.email,
      triggerId: input.triggerId,
      reason: input.reason,
      createdAt: new Date(),
    };
    this.memory.suppressions.push(row);
    return Promise.resolve(row);
  }

  delete(input: { id: string; projectId: string }): Promise<void> {
    const index = this.memory.suppressions.findIndex(
      (row) => row.id === input.id && row.projectId === input.projectId,
    );
    if (index >= 0) this.memory.suppressions.splice(index, 1);
    return Promise.resolve();
  }
}
