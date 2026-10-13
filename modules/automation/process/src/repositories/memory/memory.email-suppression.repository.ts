import type { EmailSuppression, EmailSuppressionCursor } from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";

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

  findPage(input: {
    projectId: string;
    limit: number;
    cursor: EmailSuppressionCursor | null;
  }): Promise<EmailSuppression[]> {
    const { cursor } = input;
    const newestFirst = (left: EmailSuppression, right: EmailSuppression): number => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      if (byTime !== 0) return byTime;
      if (left.id === right.id) return 0;
      return left.id < right.id ? 1 : -1;
    };
    const afterCursor = (row: EmailSuppression): boolean =>
      cursor === null ||
      row.createdAt.getTime() < cursor.createdAt.getTime() ||
      (row.createdAt.getTime() === cursor.createdAt.getTime() && row.id < cursor.id);
    return Promise.resolve(
      this.memory.suppressions
        .filter((row) => row.projectId === input.projectId && afterCursor(row))
        .toSorted(newestFirst)
        .slice(0, input.limit),
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
      createdAt: toDate(nowInstant()),
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
