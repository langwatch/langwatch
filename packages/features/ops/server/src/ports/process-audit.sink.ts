import type { ProcessAuditEntryView } from "@langwatch/ops-contract";

export type ProcessControlAction =
  | "process_wake_now"
  | "process_redrive_dead_instance"
  | "process_redrive_dead_message"
  | "process_discard_dead_message"
  /** Fleet-scoped acts record a pseudo-ref (`__fleet__`/`__all__`), the same
   *  shape scheduled singletons use for their `__global__` pseudo-project;
   *  the count moved lives in metadata. */
  | "process_redrive_dead_letters"
  | "process_discard_dead_letters"
  | "process_release_lapsed_lease";

/** Durable audit trail for Ops process-manager controls. */
export abstract class ProcessAuditSink {
  abstract append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    /** Null for a fleet-scoped act, which belongs to no one process. */
    processName: string | null;
    /** Null for a cross-tenant act. Never a placeholder: a made-up id in
     *  this column reads as a real project to everything that queries it. */
    projectId: string | null;
    processKey: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  abstract listRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]>;
}

/** For app presets that run without Postgres. */
export class NullProcessAuditSink extends ProcessAuditSink {
  static create(): NullProcessAuditSink {
    return new NullProcessAuditSink();
  }

  private constructor() {
    super();
  }

  async append(): Promise<void> {}

  async listRecent(): Promise<ProcessAuditEntryView[]> {
    return [];
  }
}
