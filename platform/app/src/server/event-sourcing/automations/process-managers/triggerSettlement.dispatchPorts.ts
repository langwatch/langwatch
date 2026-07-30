import type { NotifyDigestIntent, PersistMatchIntent } from "./triggerSettlement.types";

/**
 * What `triggerSettlement`'s intent handlers call out to.
 *
 * Deliberately narrow. The old pipeline's equivalent
 * (`triggerSettlementIntentHandlers.ts`, `event-sourcing.old/`) inlined
 * ~500 lines of channel mechanics directly into the process manager: email
 * cap consumption, Slack bot-vs-webhook branching, Liquid template
 * rendering, dataset/annotation writes. None of that is event-sourcing
 * concern — it is what happens once a settled match has been confirmed
 * still valid and not already sent, and it already lives in
 * `app-layer/automations/dispatch/*`, `app-layer/automations/trigger.service`
 * and the mailer/Slack/webhook senders. Reaching into all of that directly
 * from this pipeline is exactly the sideways coupling ADR-102 decision 5
 * rules out ("a pipeline's dependencies point downward").
 *
 * So the boundary here is a port per QUESTION the process manager's control
 * flow needs answered, not per channel: is the trigger still active, does
 * the match still hold, has this (trigger, trace) already been notified,
 * send the digest / run the persist action. The composition root (out of
 * scope for this rewrite — it is not built yet, matching every other
 * unbuilt piece of runtime named in this pipeline) adapts these to the
 * real services.
 *
 * Every param shape below is `Pick`ed from the intent payloads declared
 * once in `triggerSettlement.types.ts` (`NotifyDigestIntent`,
 * `PersistMatchIntent`), plus `tenantId` — never a parallel hand-typed
 * struct. If a payload field's type changes there, every port that reads it
 * changes with it instead of silently drifting out of sync.
 */

type WithTenant<T> = T & { readonly tenantId: string };

export interface TriggerDispatchPorts {
  /** A trigger deleted or deactivated after its match was recorded drops its
   *  pending dispatch rather than failing. */
  triggerIsActive(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId">>,
  ): Promise<boolean>;

  /**
   * Re-confirms a settled match still satisfies the trigger's own
   * conditions at dispatch time — a match observed at settle time can go
   * stale by the time the outbox actually dispatches it.
   *
   * Three outcomes, not two, because "we don't know yet" and "we know it
   * fails" call for opposite handling: `"trace-not-settled"` means the
   * trace's fold has not caught up (a retryable gap — the caller throws so
   * the outbox tries again), `"filters-failed"` means we successfully
   * re-evaluated and the trigger's conditions no longer hold (a terminal,
   * silent drop — this IS "an automation does not fire when its condition
   * is unmet", just observed at dispatch time instead of at match time).
   */
  confirmSettledMatch(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<"confirmed" | "trace-not-settled" | "filters-failed">;

  /** At-most-once notification/persist gate, independent of the outbox's own
   *  messageKey dedup. The outbox's dedup collapses a RETRY of the identical
   *  intent; this collapses two DIFFERENT intents (e.g. two separate settle
   *  rounds for the same trace) that would otherwise both fire for the same
   *  (trigger, trace) pair — "a trace is notified at most once per
   *  automation" holds across settle windows, not just across retries of one
   *  dispatch. */
  isSendClaimed(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<boolean>;

  /** Written AFTER a successful send, never before — writing it first would
   *  make a retry of a failed send silently no-op. Best-effort by the caller:
   *  the side effect already landed, so a claim-write failure must not fail
   *  the dispatch (that would retry the outbox message and double-send). */
  claimSend(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<void>;

  /** Sends the notify-class digest for the confirmed, unclaimed candidate
   *  traces. Provider selection, template rendering, caps and unsubscribe
   *  suppression all live behind this port. Throws `TerminalDispatchError`
   *  (`dispatchError.ts`) for an outcome that must not retry; anything else
   *  thrown retries on the outbox's budget. */
  sendNotifyDigest(
    params: WithTenant<Pick<NotifyDigestIntent, "triggerId" | "traceIds">>,
  ): Promise<void>;

  /** Runs the persist-class action (add-to-dataset, add-to-annotation-queue)
   *  for one confirmed, unclaimed trace. Same retry contract as
   *  `sendNotifyDigest`. */
  runPersistAction(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<void>;
}
