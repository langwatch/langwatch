import type {
  DeadLetterCount,
  DeadOutboxMessageView,
  OutboxAttemptView,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "@langwatch/ops-contract";
import type {
  ProcessNameCounts,
  ProcessOpsRepository,
} from "../repositories/process-ops.repository";

/** For app presets that run without Postgres. */
export class NullProcessOpsAdapter implements ProcessOpsRepository {
  static create(): NullProcessOpsAdapter {
    return new NullProcessOpsAdapter();
  }

  async countByProcessName(): Promise<ProcessNameCounts[]> {
    return [];
  }
  async findInstances(): Promise<{
    instances: ProcessInstanceRow[];
    total: number;
  }> {
    return { instances: [], total: 0 };
  }
  async findUpcomingWakes(): Promise<ProcessWakeRow[]> {
    return [];
  }
  async findDeadMessages(): Promise<{
    messages: DeadOutboxMessageView[];
    total: number;
  }> {
    return { messages: [], total: 0 };
  }
  async countDeadByProcessName(): Promise<DeadLetterCount[]> {
    return [];
  }
  async findOutboxMessages(): Promise<{
    messages: ProcessOutboxMessageView[];
    total: number;
  }> {
    return { messages: [], total: 0 };
  }
  async wakeInstanceNow(): Promise<{
    woke: boolean;
    previousWakeAt: number | null;
  }> {
    return { woke: false, previousWakeAt: null };
  }
  async tryRedriveDeadMessage(): Promise<null> {
    return null;
  }
  async tryDiscardDeadMessage(): Promise<null> {
    return null;
  }
  async redriveAllDeadMessages(): Promise<number> {
    return 0;
  }
  async discardAllDeadMessages(): Promise<number> {
    return 0;
  }
  async findAttempts(): Promise<OutboxAttemptView[]> {
    return [];
  }
  async tryReleaseLapsedLease(): Promise<null> {
    return null;
  }
}
