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
  /** Customer-authored notification templates (ADR-028). NULL means "this
   *  channel uses the legacy framework renderer". */
  templates: {
    slackTemplateType: string | null;
    slackTemplate: string | null;
    emailSubjectTemplate: string | null;
    emailBodyTemplate: string | null;
  };
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

/**
 * Snapshot of an open custom-graph TriggerSent row — the at-most-once
 * dedup record the cron uses for "this graph alert is still firing".
 * Used by the event-sourced path (ADR-034 Phase 5) to mirror the cron's
 * dedup discipline EXACTLY: find unresolved row -> only fire once;
 * resolve unresolved row when threshold clears.
 */
export interface OpenGraphTriggerSent {
  id: string;
  triggerId: string;
  projectId: string;
  customGraphId: string;
}

/**
 * Repository surface for the event-sourced graph-trigger path
 * (ADR-034 Phase 5). Models the EXACT TriggerSent dedup the cron uses:
 * the (triggerId, projectId, customGraphId, resolvedAt IS NULL)
 * row defines the alert's "currently firing" state.
 */
export interface GraphTriggerSentRepository {
  /**
   * Mirror of cron's `unresolvedTriggerSent` lookup
   * (src/pages/api/cron/triggers/customGraphTrigger.ts:179-189):
   * orderBy createdAt desc, take first.
   */
  findOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null>;

  /**
   * Mirror of cron's `addTriggersSent` graph branch
   * (src/pages/api/cron/triggers/utils.ts:39-48): one create per fire,
   * traceId null, customGraphId set, resolvedAt null.
   */
  createOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent>;

  /**
   * Mirror of cron's resolve sequence
   * (src/pages/api/cron/triggers/customGraphTrigger.ts:264-271): update
   * by id+projectId, set resolvedAt = now.
   */
  markResolvedById(params: {
    id: string;
    projectId: string;
    now: Date;
  }): Promise<void>;
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

  async updateLastRunAt(_triggerId: string, _projectId: string): Promise<void> {
    // no-op: NullTriggerRepository is the in-memory fallback used by tests
    // and processes that don't write trigger metadata.
  }
}
