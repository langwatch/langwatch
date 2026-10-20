import { performance } from "node:perf_hooks";

import { refusesRetry } from "@langwatch/group-queue";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";

import {
  incrementEsJobsProjectGone,
  incrementEsProcessOutboxTotal,
  observeEsProcessOutboxDispatchLag,
  observeEsProcessOutboxDuration,
} from "../../metrics.ts";
import {
  classifyClickHouseError,
  ErrorCategory,
  isProjectGone,
} from "../../services/errorHandling.ts";
import { diagnosticIsRedacted, toSafeFailureDiagnostic } from "../failureDiagnostic.ts";
import type { JsonValue } from "../json.ts";
import type {
  FailedOutboxAttempt,
  LeasedOutboxMessageRecord,
  OutboxMessageIdentity,
  ProcessStore,
} from "../stores/processStore.types.ts";
import { runDeliveryMarkingProgress } from "./deliveryProgress.ts";

/** What an intent handler receives: identity + payload, never store rows. */
export interface DispatchableMessage {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  userId?: string;
  messageKey: string;
  intentType: string;
  payload: JsonValue;
  sourceEventId: string | null;
  /** 1-based delivery attempt. */
  attempt: number;
  /**
   * When this delivery's first lease lapses, in the dispatcher's clock. The
   * dispatcher renews the lease while the handler runs, so this is the
   * earliest it can lapse; paid work may still bound itself by it.
   */
  leaseExpiresAt: number;
}

/**
 * Delivery is at-least-once: a crash between a successful handler call and
 * markDispatched redelivers the same messageKey, so handlers must be
 * idempotent on it.
 */
export type IntentHandler = (params: { message: DispatchableMessage }) => Promise<void>;

export interface OutboxDispatcherServiceOptions {
  store: ProcessStore;
  /** One handler per intentType. Unhandled types are retried, not dropped. */
  handlers: Record<string, IntentHandler>;
  /** Delivery attempts before a message is retired as dead. Default 10. */
  maxAttempts?: number;
  /** Backoff for the attempt that just failed. Default: exponential, capped. */
  retryDelayMs?: (params: { attempt: number }) => number;
  /**
   * How long a leased message stays invisible to other loops. Renewed every
   * third of it while the handler runs, so a crashed worker's message is
   * leasable again within one lease. Default 2 minutes.
   */
  leaseDurationMs?: number;
  /**
   * How long a handler may run without a call through its module's dependencies
   * (`trackDeliveryProgress`) before its lease stops being renewed and lapses.
   * Default 5 minutes; raise it only where one call may legitimately run longer.
   */
  maxSilenceMs?: number;
  /**
   * Which processNames this dispatcher serves. The outbox table is shared
   * across domains, so an unfiltered dispatcher leases other domains' intents
   * and retry-churns them for lack of a handler. Omitted means unfiltered.
   */
  processNames?: readonly string[];
  /** Max in-flight leased messages; default 1 (sequential), else serialize by key. */
  concurrency?: number;
  /**
   * Wall clock for measuring elapsed time inside one drain (the lease budget
   * check) — distinct from runOnce's `now`, the batch's logical time for lease
   * and lag math. Injectable so fake-timer tests control both.
   */
  clock?: () => number;
  tracer?: Tracer;
  logger?: Logger;
}

export interface DispatchReport {
  dispatched: string[];
  retried: string[];
  dead: string[];
  /** Returned to the pool un-attempted: the batch ran out of lease budget. */
  released: string[];
  /** Acknowledgements that matched no row — the lease lapsed mid-delivery. */
  fenced: string[];
}

const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_LEASE_DURATION_MS = 2 * 60_000;
export const DEFAULT_MAX_SILENCE_MS = 5 * 60_000;
/** Renewals per lease length: two in a row can fail before the lease lapses. */
const LEASE_RENEWALS_PER_LEASE = 3;
const SLOW_OUTBOX_DELIVERY_MS = 10_000;
/**
 * Fraction of the lease held back as the budget a delivery needs before it
 * may start, scaled to the lease rather than a flat cap that let tail
 * deliveries start on too little budget and fence anyway.
 */
const LEASE_SAFETY_MARGIN_FRACTION = 0.2;

/** One delivery's lease renewal; `isLost` once a renewal was refused. */
interface LeaseRenewal {
  isLost: () => boolean;
  markProgress: () => void;
  stop: () => Promise<void>;
}

function identityOf(message: LeasedOutboxMessageRecord): OutboxMessageIdentity {
  return {
    processName: message.processName,
    projectId: message.projectId,
    messageKey: message.messageKey,
  };
}

function defaultRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 60_000);
}

function retryAfterMsOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const retryAfterMs = Reflect.get(error, "retryAfterMs");
  return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? retryAfterMs
    : undefined;
}

/**
 * A handler can mark an error as not worth retrying by throwing with
 * `retryable: false` (DispatchError's shape) — the message retires as dead
 * immediately instead of burning the retry ladder on a permanent failure.
 */
function isTerminalError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // A transient ClickHouse cause still retries; otherwise the group queue's refusal rule decides.
  if (classifyClickHouseError(error) === ErrorCategory.RECOVERABLE) return false;
  return refusesRetry(error);
}

/**
 * A handled error the customer caused (bad configuration, invalid parameters). Read by
 * field, not instanceof, since the error may have crossed a serialisation boundary.
 */
function isCustomerFault(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "fault") === "customer" && typeof Reflect.get(error, "code") === "string"
  );
}

/** One V8 frame, `at fn (file:line:col)` or `at file:line:col`; anything else is dropped. */
const STACK_FRAME = /^at (?:(?:async |new )?[^\s()]+(?: \[as [^\s\]]+\])? \()?[^\s()]+:\d+:\d+\)?$/;

/**
 * The frames of an error's stack, read only after the whole message text so no line of
 * a multi-line message can pass for a frame. No message found in the stack, no frames.
 */
function stackFramesOf(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  const start = error.message === "" ? 0 : error.stack.indexOf(error.message);
  if (start < 0) return [];
  return error.stack
    .slice(start + error.message.length)
    .split("\n")
    .map((frame) => frame.trim())
    .filter((frame) => STACK_FRAME.test(frame));
}

/** Attempt log records DispatchError diagnostics; check by name not instanceof. */
function toAttemptDiagnostic(error: unknown): {
  errorType: string;
  errorMessage: string;
} {
  if (
    error instanceof Error &&
    error.name === "DispatchError" &&
    typeof Reflect.get(error, "retryable") === "boolean"
  ) {
    return { errorType: error.name, errorMessage: error.message };
  }
  return toSafeFailureDiagnostic(error);
}

/**
 * Leases due process-outbox messages and dispatches each inside a CONSUMER
 * span whose remote parent is restored from the message's persisted W3C
 * carrier, keeping the effect on the trace that committed its intent.
 */
export class OutboxDispatcherService {
  private readonly store: ProcessStore;
  private readonly handlers: Record<string, IntentHandler>;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (params: { attempt: number }) => number;
  private readonly leaseDurationMs: number;
  private readonly leaseRenewalIntervalMs: number;
  private readonly maxSilenceMs: number;
  private readonly processNames: readonly string[] | undefined;
  private readonly concurrency: number;
  private readonly clock: () => number;
  private readonly leaseSafetyMarginMs: number;
  private readonly tracer: Tracer;
  private readonly logger: Logger;
  /** Wall-clock instant of the last lease, settled delivery or successful renewal. */
  private lastProgress = 0;

  constructor(options: OutboxDispatcherServiceOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.leaseRenewalIntervalMs = Math.max(
      1,
      Math.floor(this.leaseDurationMs / LEASE_RENEWALS_PER_LEASE),
    );
    this.maxSilenceMs = options.maxSilenceMs ?? DEFAULT_MAX_SILENCE_MS;
    this.processNames = options.processNames;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.clock = options.clock ?? Date.now;
    this.leaseSafetyMarginMs = this.leaseDurationMs * LEASE_SAFETY_MARGIN_FRACTION;
    this.tracer = options.tracer ?? trace.getTracer("langwatch.process-manager");
    this.logger = options.logger ?? createLogger("langwatch:event-sourcing:process-outbox");
  }

  /** When this dispatcher last moved: a drain still renewing its lease is alive, not stuck. */
  lastProgressAt(): number {
    return this.lastProgress;
  }

  async runOnce(params: { now: number; limit?: number }): Promise<DispatchReport> {
    // The store anchors `leasedUntil` at `now`, which is captured BEFORE the
    // lease query runs, so the budget clock starts before it too: a slow
    // lease query (degraded Postgres is exactly when this matters) spends
    // lease budget and must not be counted as free.
    const leaseStartedAt = this.clock();
    this.lastProgress = leaseStartedAt;
    const leased = await this.store.leaseDueMessages({
      now: params.now,
      limit: params.limit ?? 10,
      leaseDurationMs: this.leaseDurationMs,
      ...(this.processNames ? { processNames: this.processNames } : {}),
    });

    const report: DispatchReport = {
      dispatched: [],
      retried: [],
      dead: [],
      released: [],
      fenced: [],
    };
    if (this.concurrency <= 1) {
      for (const message of leased) {
        await this.dispatchOrShed({
          message,
          now: params.now,
          leaseStartedAt,
          report,
        });
        this.lastProgress = this.clock();
      }
      return report;
    }

    // Bounded pool over the leased batch. Each message is independently
    // lease-fenced, so the only thing being bounded here is concurrent load on
    // whatever the handlers call.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, leased.length) }, async () => {
      while (cursor < leased.length) {
        const message = leased[cursor++]!;
        await this.dispatchOrShed({
          message,
          now: params.now,
          leaseStartedAt,
          report,
        });
        this.lastProgress = this.clock();
      }
    });
    await Promise.all(workers);
    return report;
  }

  /** Pre-delivery checks: retirement for exceeded max attempts, lease budget for slow batches. */
  private async dispatchOrShed(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    leaseStartedAt: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, leaseStartedAt, report } = params;

    if (message.attempts > this.maxAttempts) {
      await this.retire({ message, now, report });
      return;
    }

    const elapsedMs = this.clock() - leaseStartedAt;
    if (this.leaseDurationMs - elapsedMs < this.leaseSafetyMarginMs) {
      await this.releaseForLeaseBudget({ message, now, elapsedMs, report });
      return;
    }

    await this.dispatchOne({ message, now, report });
  }

  /** Retire a message whose leases kept lapsing, without running its handler. */
  private async retire(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, report } = params;
    const { applied } = await this.store.markFailed({
      identity: identityOf(message),
      leaseToken: message.leaseToken,
      now,
      nextAttemptAt: now,
      dead: true,
    });
    if (!applied) {
      this.countFenced({ message, report, phase: "retirement" });
      return;
    }
    report.dead.push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: "dead",
    });
    // A retirement kills the message without a delivery error to record, so
    // the kill still gets an attempt entry — otherwise the one death mode
    // with no exception would be the one with no history.
    await this.recordAttemptBestEffort({
      message,
      attempt: {
        attempt: message.attempts,
        occurredAt: now,
        outcome: "dead",
        errorType: "AttemptsExhausted",
        errorMessage:
          "Exhausted delivery attempts without ever acknowledging — the " +
          "handler is either not settling or repeatedly outliving the lease.",
      },
    });
    // Intentionally retain this opaque operational ID for retirement diagnostics.
    this.logger.error(
      {
        processName: message.processName,
        processKey: message.processKey,
        projectId: message.projectId,
        tenantId: message.tenantId,
        messageKey: message.messageKey,
        intentType: message.intentType,
        attempts: message.attempts,
      },
      "Process-manager outbox message exhausted its attempts without ever " +
        "acknowledging — retiring it as dead. Its handler is either not " +
        "settling or repeatedly outliving the lease.",
    );
  }

  /**
   * The attempt log is diagnosis, not accounting: a failed history write must
   * never fail the delivery bookkeeping, so the entry is the only loss
   * (specs/ops/dead-letter-recovery.feature).
   */
  private async recordAttemptBestEffort(params: {
    message: LeasedOutboxMessageRecord;
    attempt: FailedOutboxAttempt;
  }): Promise<void> {
    try {
      await this.store.recordFailedAttempt({
        identity: identityOf(params.message),
        attempt: params.attempt,
      });
    } catch (error) {
      const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
      this.logger.warn(
        {
          processName: params.message.processName,
          messageKey: params.message.messageKey,
          intentType: params.message.intentType,
          attempt: params.attempt.attempt,
          errorType,
          errorMessage,
        },
        "Failed to record an outbox attempt entry; delivery accounting is unaffected",
      );
    }
  }

  /** Hand a batch tail back to the pool because the lease budget ran out. */
  private async releaseForLeaseBudget(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    elapsedMs: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, elapsedMs, report } = params;
    const { applied } = await this.store.releaseLease({
      identity: identityOf(message),
      leaseToken: message.leaseToken,
      now,
    });
    const fields = {
      processName: message.processName,
      messageKey: message.messageKey,
      intentType: message.intentType,
      elapsedMs: Math.round(elapsedMs),
      leaseDurationMs: this.leaseDurationMs,
    };
    if (!applied) {
      // The lease lapsed before the budget check could hand the message back,
      // so a rival dispatcher already re-leased it. Silent here would be the
      // same blind spot the fencing counters exist to remove.
      this.logger.warn(
        fields,
        "Lease release matched no row; the lease had already lapsed and " +
          "another dispatcher re-leased the message",
      );
      return;
    }
    report.released.push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: "released",
    });
    this.logger.debug(
      fields,
      "Released a leased outbox message un-attempted; the batch ran out of " + "lease budget",
    );
  }

  private countFenced(params: {
    message: LeasedOutboxMessageRecord;
    report: DispatchReport;
    phase: "dispatched" | "failed" | "retirement" | "renewal";
    durationMs?: number;
  }): void {
    const { message, report, phase, durationMs } = params;
    report.fenced.push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: "fenced",
    });
    // Intentionally retain this opaque operational ID for fencing diagnostics.
    this.logger.warn(
      {
        processName: message.processName,
        processKey: message.processKey,
        projectId: message.projectId,
        tenantId: message.tenantId,
        messageKey: message.messageKey,
        intentType: message.intentType,
        attempt: message.attempts,
        phase,
        ...(durationMs !== undefined ? { durationMs: Math.round(durationMs) } : {}),
      },
      "Process-manager outbox acknowledgement was fenced by a lapsed lease — " +
        "another dispatcher superseded it and the effect may have run more " +
        "than once; message-key idempotency in the handler absorbs the " +
        "duplicate",
    );
  }

  private async dispatchOne(params: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
  }): Promise<void> {
    const { message, now, report } = params;
    // Leasing already incremented `attempts`, so the leased record carries
    // this delivery's 1-based attempt number.
    const attempt = message.attempts;
    const identity = identityOf(message);
    const remoteParent = propagation.extract(ROOT_CONTEXT, message.traceCarrier);

    await this.tracer.startActiveSpan(
      `process ${message.processName} dispatch ${message.intentType}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "process.name": message.processName,
          "process.key": message.processKey,
          "process.source_event_id": message.sourceEventId ?? undefined,
          "process.message_key": message.messageKey,
          "process.intent_type": message.intentType,
          "process.attempt": attempt,
          "tenant.id": message.tenantId,
          "project.id": message.projectId,
          ...(message.userId ? { "user.id": message.userId } : {}),
        },
      },
      remoteParent,
      (span) =>
        this.dispatchWithinSpan({
          message,
          now,
          report,
          attempt,
          identity,
          span,
        }),
    );
  }

  private async dispatchWithinSpan({
    message,
    now,
    report,
    attempt,
    identity,
    span,
  }: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
    attempt: number;
    identity: OutboxMessageIdentity;
    span: Span;
  }): Promise<void> {
    const startedAt = performance.now();
    // Commit → first-dispatch delay (ADR-054): the substrate's direct
    // "is the outbox draining" signal. First attempt only — retries
    // re-enter with deliberate backoff, which is not queueing delay.
    if (attempt === 1) {
      observeEsProcessOutboxDispatchLag({
        processName: message.processName,
        lagMs: now - message.createdAt,
      });
    }
    try {
      const handler = this.handlers[message.intentType];
      if (!handler) {
        throw new Error(`No handler registered for intent type "${message.intentType}"`);
      }
      const { leaseLost } = await this.runHoldingLease({
        message,
        now,
        run: () =>
          handler({
            message: {
              processName: message.processName,
              projectId: message.projectId,
              processKey: message.processKey,
              tenantId: message.tenantId,
              userId: message.userId,
              messageKey: message.messageKey,
              intentType: message.intentType,
              payload: message.payload,
              sourceEventId: message.sourceEventId,
              attempt,
              // The store anchored the lease at this drain's `now`.
              leaseExpiresAt: now + this.leaseDurationMs,
            },
          }),
      });
      if (leaseLost) {
        // Another dispatcher holds the message now: its outcome, not this one, is recorded.
        this.countFenced({
          message,
          report,
          phase: "renewal",
          durationMs: performance.now() - startedAt,
        });
        return;
      }
      const { applied } = await this.store.markDispatched({
        identity,
        leaseToken: message.leaseToken,
        now,
      });
      if (!applied) {
        this.countFenced({
          message,
          report,
          phase: "dispatched",
          durationMs: performance.now() - startedAt,
        });
        return;
      }
      report.dispatched.push(message.messageKey);
      incrementEsProcessOutboxTotal({
        processName: message.processName,
        intentType: message.intentType,
        status: "dispatched",
      });
    } catch (error) {
      if (isProjectGone(error)) {
        await this.completeProjectGone({ message, now, report, attempt, identity, startedAt });
        return;
      }
      await this.handleDispatchFailure({
        message,
        now,
        report,
        attempt,
        identity,
        span,
        startedAt,
        error,
      });
    } finally {
      this.finishDispatchSpan({ message, attempt, span, startedAt });
    }
  }

  /**
   * A message whose project was deleted after it was written can never be delivered: it is
   * retired as dispatched with a warning, not retried and not dead-lettered
   * (specs/eventing/deleted-project-jobs.feature).
   */
  private async completeProjectGone({
    message,
    now,
    report,
    attempt,
    identity,
    startedAt,
  }: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
    attempt: number;
    identity: OutboxMessageIdentity;
    startedAt: number;
  }): Promise<void> {
    const { applied } = await this.store.markDispatched({
      identity,
      leaseToken: message.leaseToken,
      now,
    });
    if (!applied) {
      this.countFenced({
        message,
        report,
        phase: "dispatched",
        durationMs: performance.now() - startedAt,
      });
      return;
    }
    report.dispatched.push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: "dispatched",
    });
    incrementEsJobsProjectGone({ queue: "process_outbox", jobType: message.intentType, count: 1 });
    // Intentionally retain this opaque operational ID for delivery diagnostics.
    this.logger.warn(
      {
        processName: message.processName,
        processKey: message.processKey,
        projectId: message.projectId,
        tenantId: message.tenantId,
        messageKey: message.messageKey,
        intentType: message.intentType,
        attempt,
      },
      "Outbox message's project no longer exists; retiring it as completed",
    );
  }

  /**
   * Runs one handler while renewing its lease. A refused renewal means another
   * dispatcher leased the message, so this run's outcome, success or error, is dropped.
   */
  private async runHoldingLease({
    message,
    now,
    run,
  }: {
    message: LeasedOutboxMessageRecord;
    now: number;
    run: () => Promise<void>;
  }): Promise<{ leaseLost: boolean }> {
    const renewal = this.startLeaseRenewal({ message, now });
    let failure: { error: unknown } | null = null;
    try {
      await runDeliveryMarkingProgress({ markProgress: renewal.markProgress, run });
    } catch (error) {
      failure = { error };
    } finally {
      await renewal.stop();
    }
    if (renewal.isLost()) return { leaseLost: true };
    if (failure) throw failure.error;
    return { leaseLost: false };
  }

  /**
   * Renewals stay in the store's frame: the drain's `now` advanced by the wall clock since.
   * A handler silent past `maxSilenceMs` is no longer renewed, so a hung one cannot hold
   * its message forever: the lease lapses and the usual redelivery and retirement apply.
   */
  private startLeaseRenewal({
    message,
    now,
  }: {
    message: LeasedOutboxMessageRecord;
    now: number;
  }): LeaseRenewal {
    const startedAt = this.clock();
    let lastProgressAt = startedAt;
    let lost = false;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let renewing: Promise<void> = Promise.resolve();
    const fields = {
      processName: message.processName,
      messageKey: message.messageKey,
      intentType: message.intentType,
      attempt: message.attempts,
    };
    const renew = async (): Promise<void> => {
      try {
        const { applied } = await this.store.renewLease({
          identity: identityOf(message),
          leaseToken: message.leaseToken,
          now: now + (this.clock() - startedAt),
          leaseDurationMs: this.leaseDurationMs,
        });
        if (applied) {
          this.lastProgress = this.clock();
          return;
        }
        lost = true;
        this.logger.warn(
          fields,
          "Outbox lease renewal refused; another dispatcher took the message",
        );
      } catch (error) {
        // A failed renewal is retried on the next tick, which still lands before the lease lapses.
        this.logger.warn(
          { ...fields, ...toSafeFailureDiagnostic(error) },
          "Outbox lease renewal failed; retrying on the next tick",
        );
      }
    };
    const silentTooLong = (): boolean => {
      const silenceMs = this.clock() - lastProgressAt;
      if (silenceMs <= this.maxSilenceMs) return false;
      stopped = true;
      this.logger.warn(
        { ...fields, silenceMs: Math.round(silenceMs), maxSilenceMs: this.maxSilenceMs },
        "Outbox handler made no call through its dependencies within its silence limit; " +
          "its lease is no longer renewed and will lapse, so the message is redelivered",
      );
      return true;
    };
    const arm = (): void => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        timer = null;
        if (silentTooLong()) return;
        renewing = renew().then(arm);
      }, this.leaseRenewalIntervalMs);
      timer.unref();
    };
    arm();
    return {
      isLost: () => lost,
      markProgress: () => {
        lastProgressAt = this.clock();
      },
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await renewing;
      },
    };
  }

  private async handleDispatchFailure({
    message,
    now,
    report,
    attempt,
    identity,
    span,
    startedAt,
    error,
  }: {
    message: LeasedOutboxMessageRecord;
    now: number;
    report: DispatchReport;
    attempt: number;
    identity: OutboxMessageIdentity;
    span: Span;
    startedAt: number;
    error: unknown;
  }): Promise<void> {
    const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
    span.recordException({
      name: errorType,
      message: errorMessage,
    });
    span.setStatus({ code: SpanStatusCode.ERROR });
    const dead = attempt >= this.maxAttempts || isTerminalError(error);
    const retryDelayMs = Math.max(this.retryDelayMs({ attempt }), retryAfterMsOf(error) ?? 0);
    const { applied } = await this.store.markFailed({
      identity,
      leaseToken: message.leaseToken,
      now,
      nextAttemptAt: now + retryDelayMs,
      dead,
    });
    if (!applied) {
      this.countFenced({
        message,
        report,
        phase: "failed",
        durationMs: performance.now() - startedAt,
      });
      return;
    }
    (dead ? report.dead : report.retried).push(message.messageKey);
    incrementEsProcessOutboxTotal({
      processName: message.processName,
      intentType: message.intentType,
      status: dead ? "dead" : "retried",
    });
    const attemptRetryAfterMs = retryAfterMsOf(error);
    const attemptDiagnostic = toAttemptDiagnostic(error);
    await this.recordAttemptBestEffort({
      message,
      attempt: {
        attempt,
        occurredAt: now,
        outcome: dead ? "dead" : "retry_scheduled",
        ...attemptDiagnostic,
        ...(attemptRetryAfterMs !== undefined ? { retryAfterMs: attemptRetryAfterMs } : {}),
      },
    });
    if (dead || attempt === 1) {
      const hasCustomerFault = isCustomerFault(error);
      this.logDispatchFailure({
        message,
        attempt,
        dead,
        errorType,
        errorMessage,
        hasCustomerFault,
      });
      if (diagnosticIsRedacted(error)) {
        this.logRedactedCause({ message, attempt, error, dead, hasCustomerFault });
      }
    }
  }

  /**
   * Everything else carries only the redacted sentence, so this keeps where it failed:
   * class and stack frames, never the foreign message or the payload. Its level follows
   * the outcome, so a retry or a customer's own refusal never pages.
   */
  private logRedactedCause({
    message,
    attempt,
    error,
    dead,
    hasCustomerFault,
  }: {
    message: LeasedOutboxMessageRecord;
    attempt: number;
    error: unknown;
    dead: boolean;
    hasCustomerFault: boolean;
  }): void {
    // Intentionally retain this opaque operational ID for delivery diagnostics.
    const fields = {
      processName: message.processName,
      processKey: message.processKey,
      projectId: message.projectId,
      tenantId: message.tenantId,
      messageKey: message.messageKey,
      sourceEventId: message.sourceEventId,
      intentType: message.intentType,
      attempt,
      outcome: dead ? "dead" : "retry_scheduled",
      causeType: toSafeFailureDiagnostic(error).errorType,
      causeStackFrames: stackFramesOf(error),
    };
    const line =
      "Process-manager outbox delivery failed with a redacted cause; stack frames attached";
    if (dead && !hasCustomerFault) this.logger.error(fields, line);
    else this.logger.warn(fields, line);
  }

  private logDispatchFailure({
    message,
    attempt,
    dead,
    errorType,
    errorMessage,
    hasCustomerFault,
  }: {
    message: LeasedOutboxMessageRecord;
    attempt: number;
    dead: boolean;
    errorType: string;
    errorMessage: string;
    hasCustomerFault: boolean;
  }): void {
    // Intentionally retain this opaque operational ID for delivery diagnostics.
    const fields = {
      processName: message.processName,
      processKey: message.processKey,
      projectId: message.projectId,
      tenantId: message.tenantId,
      userId: message.userId,
      messageKey: message.messageKey,
      sourceEventId: message.sourceEventId,
      intentType: message.intentType,
      attempt,
      outcome: dead ? "dead" : "retry_scheduled",
      errorType,
      errorMessage,
    };
    if (dead && hasCustomerFault) {
      // The customer's own setup refused the delivery; nothing for on-call to act on.
      this.logger.warn(fields, "Process-manager outbox message exhausted delivery attempts");
    } else if (dead) {
      this.logger.error(fields, "Process-manager outbox message exhausted delivery attempts");
    } else {
      this.logger.warn(fields, "Process-manager outbox delivery failed; retry scheduled");
    }
  }

  private finishDispatchSpan({
    message,
    attempt,
    span,
    startedAt,
  }: {
    message: LeasedOutboxMessageRecord;
    attempt: number;
    span: Span;
    startedAt: number;
  }): void {
    const durationMs = performance.now() - startedAt;
    observeEsProcessOutboxDuration({
      processName: message.processName,
      intentType: message.intentType,
      durationMs,
    });
    if (durationMs >= SLOW_OUTBOX_DELIVERY_MS) {
      // Intentionally retain this opaque operational ID for slow-delivery diagnostics.
      this.logger.warn(
        {
          processName: message.processName,
          processKey: message.processKey,
          projectId: message.projectId,
          tenantId: message.tenantId,
          userId: message.userId,
          messageKey: message.messageKey,
          sourceEventId: message.sourceEventId,
          intentType: message.intentType,
          attempt,
          durationMs: Math.round(durationMs),
        },
        "Process-manager outbox delivery is slow",
      );
    }
    span.end();
  }
}
