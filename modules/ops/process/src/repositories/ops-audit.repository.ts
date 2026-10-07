// The operator trails as read back. The acts are written through the audit
// log by ops' audit services; these repositories only list them.
import type { ProcessAuditEntryView, SchedulerAuditEntryView } from "@langwatch/ops-contract";

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

/** Ops process-manager controls as recorded, read back for the operator trail. */
export abstract class ProcessAuditRepository {
  abstract findRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]>;
}

/** Ops scheduler controls as recorded, read back for the operator trail. */
export abstract class SchedulerAuditRepository {
  abstract findRecent(params: { limit: number }): Promise<SchedulerAuditEntryView[]>;
}
