/**
 * Single queue, two stages (ADR-030 revision + ADR-027 + ADR-026).
 *
 * The unified outbox queue carries both trace-readiness settling and
 * cadence digest dispatch in one `process` callback via the `stage`
 * discriminator. Per-stage queue behavior (dedup, delay, group key,
 * coalescing) is driven by `stage` so one queue serves both timing
 * primitives without merging them — the operator's `traceDebounceMs`
 * and `notificationCadence` knobs stay independently tunable.
 *
 * - **settle**: per-(trigger, trace). Sent on every event the reactor
 *   sees as a candidate match. Dedup mode is debounce (extend + replace
 *   TTL) keyed on `(projectId, triggerId, traceId)`, so subsequent
 *   spans on the same trace reset the timer and carry the latest fold.
 *   When TTL elapses without a new event, the process callback loads
 *   fresh fold, runs filters, and — on match — re-enqueues as a
 *   `cadence` job. The `TriggerSent` at-most-once gate is owned by the
 *   cadence stage (read pre-dispatch, written post-dispatch).
 * - **cadence**: per-trigger. Carries one matched (trigger, trace)
 *   pair. Delay snaps to the next wall-clock cadence boundary; the
 *   queue's `processBatch` + `coalesceMaxBatch` groups every cadence
 *   job for the same trigger landing in the same boundary into one
 *   dispatcher invocation — that's the digest.
 *
 * Audit projection (PG `ReactorOutbox`) is written for BOTH stages,
 * sharing one row via `auditDedupKey` so operators see the full
 * lifecycle:
 *   settle.onEnqueue → status="queued", scheduledAt=settle end
 *   settle.onLeased → status="dispatching"
 *   settle.onDispatched (no match) → status="dispatched",
 *     lastError="settle: no match"
 *   settle.onDispatched (matched + cadence re-enqueued) → cadence's
 *     onEnqueue has already moved the row back to "queued"; settle's
 *     terminal update no-ops via a `WHERE status='dispatching'` CAS
 *   cadence.onEnqueue → UPDATE → status="queued", new scheduledAt
 *   cadence.onLeased → status="dispatching"
 *   cadence.onDispatched → status="dispatched"
 */

export const TRIGGER_NOTIFY_REACTOR_NAME = "triggerNotify" as const;

/**
 * Which dispatch class a settle/cadence payload belongs to (ADR-035).
 * Both action classes now ride the same settle → cadence outbox path,
 * so the marker is what lets `handleSettle` / `handleCadenceBatch`
 * branch on dispatch shape without re-classifying `trigger.action`:
 *
 * - `notify`  → SEND_EMAIL / SEND_SLACK_MESSAGE: digest-cadence aware,
 *   rendered + provider-sent in `handleCadenceBatch`.
 * - `persist` → ADD_TO_DATASET / ADD_TO_ANNOTATION_QUEUE: immediate
 *   cadence (no digest), dispatched per-match via `dispatchTriggerAction`.
 *
 * The reactor stamps it at enqueue; settle copies it onto the cadence
 * payload it re-enqueues; cadence reads it to pick the dispatch branch.
 */
export type TriggerActionClass = "notify" | "persist";

/**
 * Both stages carry the SAME `auditDedupKey` so they project onto one
 * `ReactorOutbox` row through the lifecycle: settle's INSERT,
 * settle's leased/dispatched-or-noMatch, cadence's UPDATE, cadence's
 * leased/dispatched. The GroupQueue's own dedup id is different per
 * stage (settle uses Debounce Mode, cadence does not) — that key is
 * for queue-level collapse, not PG row identity.
 */
interface CommonStagePayload {
  projectId: string;
  triggerId: string;
  reactorName: typeof TRIGGER_NOTIFY_REACTOR_NAME;
  auditDedupKey: string;
  /**
   * Dispatch class of the underlying trigger action (ADR-035). Carried
   * on the payload so the cadence handler routes persist vs notify
   * without re-reading `trigger.action`. Optional for backwards
   * compatibility with rows enqueued before ADR-035: a missing marker
   * is treated as `notify` by the dispatcher (the only class that rode
   * the outbox in v1).
   */
  actionClass?: TriggerActionClass;
}

export interface SettleStagePayload
  extends CommonStagePayload,
    Record<string, unknown> {
  stage: "settle";
  traceId: string;
  /**
   * Fold snapshot at enqueue time. The settle process callback
   * **re-reads** the fold from the projection store at fire time so a
   * 30-second-old snapshot doesn't drive the filter check — the
   * snapshot here is only a debugging breadcrumb.
   */
  foldSnapshotAtEnqueue: {
    computedInput: string;
    computedOutput: string;
  };
}

export interface CadenceStagePayload
  extends CommonStagePayload,
    Record<string, unknown> {
  stage: "cadence";
  match: {
    traceId: string;
    input: string;
    output: string;
  };
  /**
   * Set by the dispatcher when a cadence dispatch resolves to a no-op
   * (over the hourly cap, or every recipient suppressed — ADR-031). The PG
   * audit adapter reads this in `onDispatched` and records it as the row's
   * `lastError` so a drop is distinguishable from a delivered send (a delivered
   * cadence row clears `lastError` to null). Absent on a real delivery. Drops
   * stay NON-retryable: the dispatcher returns normally rather than throwing.
   */
  dropReason?: string;
  /**
   * Set by the dispatcher after rendering a custom email/Slack template
   * (ADR-036 / ADR-037). Carries the render-health diagnostics
   * `renderTriggerEmail` / `renderTriggerSlack` compute — currently the
   * `missingVariables` the template referenced but the render context did not
   * supply. The PG audit adapter reads this in `onDispatched` and writes it to
   * the row's `renderDiagnostics` so the operator surface can show
   * "N missing variables" per dispatch. `null` on a clean render (no missing
   * variables) and absent on dispatches that never rendered a custom template.
   */
  renderDiagnostics?: { missingVariables: string[] } | null;
}

export type OutboxJob = SettleStagePayload | CadenceStagePayload;

// Widened to accept any unknown payload — these are the discriminators
// the main event-sourcing queue uses to pick off outbox jobs from
// non-outbox jobs (ADR-030 r3), so they need to be safe to call on
// arbitrary `Record<string, unknown>`.
export function isSettle(
  job: Record<string, unknown>,
): job is SettleStagePayload {
  return (job as { stage?: unknown }).stage === "settle";
}

export function isCadence(
  job: Record<string, unknown>,
): job is CadenceStagePayload {
  return (job as { stage?: unknown }).stage === "cadence";
}

/**
 * Per-(trigger, trace) dedup key for the settle stage. Identity for
 * the GroupQueue Debounce Mode entry — repeat sends within the TTL
 * collapse onto the existing pending job.
 */
export function settleDedupId(params: {
  projectId: string;
  triggerId: string;
  traceId: string;
}): string {
  return `${params.projectId}/${params.triggerId}/${params.traceId}`;
}

/**
 * Per-(trigger, trace) audit row identity. Both settle and cadence
 * payloads carry this on `auditDedupKey` so they target one row in
 * `ReactorOutbox` through the full lifecycle. Collisions are the
 * replay-safe claim primitive (ADR-030).
 */
export function auditDedupKey(params: {
  projectId: string;
  triggerId: string;
  traceId: string;
}): string {
  return `${params.projectId}/${params.triggerId}:trace:${params.traceId}`;
}

/**
 * Per-(trigger, trace) group key for the settle stage. Per-trace FIFO
 * so a noisy trace doesn't head-of-line block other traces' settle
 * windows.
 */
export function settleGroupKey(params: {
  projectId: string;
  triggerId: string;
  traceId: string;
}): string {
  return `${params.projectId}/${TRIGGER_NOTIFY_REACTOR_NAME}:${params.triggerId}:${params.traceId}`;
}

/**
 * Per-trigger group key for the cadence stage. All matched traces for
 * a trigger landing in the same wall-clock cadence boundary group
 * together via the queue's `processBatch` — one dispatcher invocation,
 * one digest send.
 */
export function cadenceGroupKey(params: {
  projectId: string;
  triggerId: string;
}): string {
  return `${params.projectId}/${TRIGGER_NOTIFY_REACTOR_NAME}:${params.triggerId}`;
}
