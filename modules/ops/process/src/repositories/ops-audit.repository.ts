// The durable operator trails this module owns. One definition of what an
// operator act is, shared by the stored rows and by the memory twins.
import type {
  ProcessAuditEntryView,
  SchedulerAuditEntryView,
  SchedulerControlAction,
} from "@langwatch/ops-contract";

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
export abstract class ProcessAuditRepository {
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

/** Durable audit trail for Ops scheduler controls. */
export abstract class SchedulerAuditRepository {
  abstract append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void>;

  abstract listRecent(params: { limit: number }): Promise<SchedulerAuditEntryView[]>;
}
