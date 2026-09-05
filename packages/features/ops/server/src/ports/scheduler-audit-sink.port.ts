import type { SchedulerAuditEntryView, SchedulerControlAction } from "@langwatch/ops-contract";

/** Durable audit trail for Ops scheduler controls. */
export abstract class SchedulerAuditSinkPort {
  abstract append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void>;

  abstract listRecent(params: { limit: number }): Promise<SchedulerAuditEntryView[]>;
}

export class NoopSchedulerAuditSink extends SchedulerAuditSinkPort {
  private constructor() {
    super();
  }

  static create(): NoopSchedulerAuditSink {
    return new NoopSchedulerAuditSink();
  }

  async append(): Promise<void> {}

  async listRecent(): Promise<SchedulerAuditEntryView[]> {
    return [];
  }
}
