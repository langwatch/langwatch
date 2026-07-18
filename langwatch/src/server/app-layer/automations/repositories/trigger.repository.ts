import type {
  AlertType,
  Prisma,
  Trigger,
  TriggerAction,
  TriggerKind,
} from "@prisma/client";
import type { NotificationCadence } from "@langwatch/automations/cadences";
import type { TriggerFilters } from "~/server/filters/types";

export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  /** ADR-044 automation kind. Load-bearing at dispatch: a REPORT fires on its
   *  calendar schedule only, so it must never be treated as a trace automation.
   *  A report persists `filters: {}` and no `customGraphId`, which is exactly
   *  the shape of a match-everything trace trigger — the kind is the ONLY thing
   *  that tells them apart. */
  triggerKind: TriggerKind;
  actionParams: unknown;
  filters: TriggerFilters;
  /** ADR-043 Subject facet: the Traces-V2 liqe query the automation is about.
   *  NULL = legacy `filters`-driven trigger; when set, the dispatcher evaluates
   *  it in-memory against fold state and ignores `filters`. */
  filterQuery: string | null;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  /** Per-trigger trace-readiness debounce in ms (ADR-026). Always populated by
   *  the repository — the column is `NOT NULL DEFAULT 30000`. */
  traceDebounceMs: number;
  /** Customer-authored notification templates (ADR-036). NULL means "this
   *  channel uses the legacy framework renderer". */
  templates: {
    slackTemplateType: string | null;
    slackTemplate: string | null;
    emailSubjectTemplate: string | null;
    emailBodyTemplate: string | null;
  };
}

/**
 * The minimum a report needs to (re)build its calendar schedule: the trigger
 * identity plus its raw `actionParams` (the cron/timezone live inside, parsed
 * by `extractReportFromTriggerRow`). Returned by the cross-tenant reconciliation
 * read.
 */
export interface ReportScheduleTarget {
  id: string;
  projectId: string;
  actionParams: unknown;
}

export interface TriggerRepository {
  findActiveForProject(projectId: string): Promise<TriggerSummary[]>;

  /**
   * Every active, non-deleted REPORT trigger across all projects — the input to
   * the boot-time report-schedule reconciliation (ADR-044). Cross-tenant by
   * design (one scheduler serves every project); the caller only writes back
   * project-scoped `ScheduledJob` rows, so tenancy is preserved on the writes.
   */
  findActiveReportTargets(): Promise<ReportScheduleTarget[]>;

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

  /**
   * Full trigger row by id, scoped to the calling project (multitenancy —
   * a foreign-tenant id resolves to null, never a row). Authoring read used
   * by the automations router: detail view, toggle, saved-secret resolution
   * (Slack bot token / webhook headers), and edit-time `loadExisting`.
   */
  findById(params: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null>;

  /**
   * Every non-(soft-)deleted trigger for a project, newest first — the
   * automations list. Includes inactive (paused) rows by design.
   */
  findAllByProjectId(params: { projectId: string }): Promise<Trigger[]>;

  /**
   * The trigger occupying a custom graph's unique alert slot — deleted or
   * not. `deleteById` soft-deletes (the row keeps its @unique customGraphId),
   * so a fresh create for a graph that ever had an alert must find and
   * reactivate this row instead of violating the unique index.
   */
  findFirstByCustomGraphId(params: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null>;

  /** Persist a new trigger row. `data` must carry `projectId` (multitenancy). */
  create(params: { data: Prisma.TriggerUncheckedCreateInput }): Promise<Trigger>;

  /** Update a trigger row, scoped to the calling project. */
  update(params: {
    triggerId: string;
    projectId: string;
    data: Prisma.TriggerUncheckedUpdateInput;
  }): Promise<Trigger>;
}

/**
 * Snapshot of an open custom-graph TriggerSent row — the at-most-once
 * dedup record for "this graph alert is still firing".
 * The event-sourced path uses it to preserve the open-incident discipline:
 * find unresolved row -> only fire once;
 * resolve unresolved row when threshold clears.
 */
export interface OpenGraphTriggerSent {
  id: string;
  triggerId: string;
  projectId: string;
  customGraphId: string;
}

/**
 * The identity of an open graph-alert incident. Written to
 * `TriggerSent.openIncidentKey` while the alert is firing and cleared to NULL
 * on resolve. The single-column unique index on that column turns the INSERT
 * into the atomic claim: at most ONE open incident can exist per identity,
 * because Postgres treats NULLs as distinct (so any number of resolved rows,
 * all carrying NULL, coexist).
 *
 * `@@unique([triggerId, traceId])` cannot guard graph alerts — `traceId` is
 * NULL for them — which is exactly the race this key closes: two evaluators
 * that both pass the `findOpenForGraphAlert` pre-check cannot both open an
 * incident once the INSERT arbitrates on this column.
 *
 * Namespaced with a `graph-alert:` prefix so the column can host other incident
 * kinds later without their keyspaces colliding. `triggerId` is globally
 * unique, so one trigger maps to exactly one live incident identity. This is
 * the single source of truth for the string — the claim writes it and the
 * resolve clears it, so nothing else may hand-roll the format.
 */
export function graphAlertIncidentKey({
  triggerId,
}: {
  triggerId: string;
}): string {
  return `graph-alert:${triggerId}`;
}

/**
 * Repository surface for the event-sourced graph-trigger path
 * (ADR-034 Phase 5). Models the EXACT TriggerSent dedup the cron uses:
 * the (triggerId, projectId, customGraphId, resolvedAt IS NULL)
 * row defines the alert's "currently firing" state.
 */
export interface GraphTriggerSentRepository {
  /**
   * Lookup used by the event-sourced graph-alert evaluator: order by
   * createdAt descending and take the newest open incident.
   */
  findOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null>;

  /**
   * The most recent incident row for this (trigger, graph) — OPEN OR
   * RESOLVED. Its id is the alert's fire GENERATION: a new row appears only
   * once a fire has actually been delivered, so the id is stable while a fire
   * is still being retried and changes exactly once the next incident opens.
   * Null before the alert has ever fired.
   *
   * That is precisely what a per-recipient idempotency key needs. Keying the
   * ledger on the alert's identity alone would suppress every future fire
   * forever; keying it on wall-clock would re-send across a retry that crosses
   * the bucket boundary. See `graphAlertFireDigest`.
   */
  findLatestForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null>;

  /**
   * Atomically claim the alert's single OPEN incident BEFORE any provider
   * side effect (ADR-034 P1). Inserts a TriggerSent row (traceId null,
   * customGraphId set, resolvedAt null) with `openIncidentKey` set to
   * {@link graphAlertIncidentKey}. The single-column unique on that column is
   * the real race guard: exactly one concurrent evaluator inserts, the rest hit
   * a Prisma P2002 unique violation.
   *
   * Returns the created row for the winner, or `null` for a caller that lost
   * the race — the loser MUST NOT dispatch. Replaces the former
   * check-then-`createOpenForGraphAlert`, whose window let two evaluators both
   * pass the pre-check and both dispatch before either wrote its row.
   */
  claimOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null>;

  /**
   * Roll back a claim whose dispatch delivered nothing (didSend false): delete
   * the just-claimed row so its `openIncidentKey` frees up and the next
   * evaluation can re-claim and re-dispatch. Without this an alert that reached
   * nobody would sit "firing" forever, suppressing every future notification —
   * the guarantee the didSend gate added.
   */
  deleteOpenClaim(params: { id: string; projectId: string }): Promise<void>;

  /**
   * Resolve an event-sourced graph-alert incident by id+projectId, set
   * resolvedAt = now, and clear `openIncidentKey` back to
   * NULL, so the identity frees for the next fire. Setting resolvedAt without
   * clearing the key would wedge the alert: the next claim's INSERT would hit
   * the still-held unique key and never fire again.
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

  async findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
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

  async findById(_params: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null> {
    return null;
  }

  async findAllByProjectId(_params: { projectId: string }): Promise<Trigger[]> {
    return [];
  }

  async findFirstByCustomGraphId(_params: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return null;
  }

  async create(_params: {
    data: Prisma.TriggerUncheckedCreateInput;
  }): Promise<Trigger> {
    // Loud by design: there is no honest Trigger row to fabricate. Wiring
    // that reaches authoring writes must inject a real repository.
    throw new Error("Trigger authoring is not supported by NullTriggerRepository");
  }

  async update(_params: {
    triggerId: string;
    projectId: string;
    data: Prisma.TriggerUncheckedUpdateInput;
  }): Promise<Trigger> {
    throw new Error("Trigger authoring is not supported by NullTriggerRepository");
  }
}
