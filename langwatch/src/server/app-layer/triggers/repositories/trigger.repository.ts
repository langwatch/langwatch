import type { AlertType, TriggerAction } from "@prisma/client";
import type { NotificationCadence } from "~/automations/cadences";
import type { TriggerFilters } from "~/server/filters/types";

export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  actionParams: unknown;
  filters: TriggerFilters;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  /** Per-trigger trace-readiness debounce in ms (ADR-026). Always populated by
   *  the repository — the column is `NOT NULL DEFAULT 30000`. */
  traceDebounceMs: number;
}

export interface TriggerRepository {
  findActiveForProject(projectId: string): Promise<TriggerSummary[]>;

  /**
   * Atomically claim ownership of (triggerId, traceId). Inserts a
   * TriggerSent row using the unique (triggerId, traceId) constraint.
   * Returns true iff this caller is the first to claim the pair —
   * at-most-once dispatch is built on top of this guarantee. Concurrent
   * reactors (trace-processing + evaluation-processing) racing on the
   * same trigger/trace will each see exactly one `true`.
   */
  claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /**
   * Read-only existence check for a (triggerId, traceId) claim. Used by
   * the outbox cadence dispatcher to suppress re-emits across batches
   * without committing the at-most-once gate before the provider call
   * returns — claiming pre-dispatch would let a retryable provider
   * failure permanently no-op the retry.
   */
  isSendClaimed(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /** Updates the trigger's lastRunAt timestamp. */
  updateLastRunAt(triggerId: string, projectId: string): Promise<void>;
}

export class NullTriggerRepository implements TriggerRepository {
  async findActiveForProject(_projectId: string): Promise<TriggerSummary[]> {
    return [];
  }

  async claimSend(_params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return true;
  }

  async isSendClaimed(_params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return false;
  }

  async updateLastRunAt(
    _triggerId: string,
    _projectId: string,
  ): Promise<void> {}
}
