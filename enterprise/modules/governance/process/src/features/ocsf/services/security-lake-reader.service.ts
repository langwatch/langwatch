// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  OCSF_INGEST_MAX_FUTURE_MS,
  SECURITY_LAKE_SOURCE_TYPE,
  type SecurityLakePullConfig,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import type {
  GovernanceObjectStorageCredentials,
  GovernanceObjectStore,
} from "../../../channels/object-store.channel.ts";
import type {
  SecurityLakeQueue,
  SecurityLakeQueueMessage,
  SecurityLakeQueueTarget,
} from "../../../channels/security-lake-queue.channel.ts";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventSink,
} from "../../../repositories/governance.repositories.ts";
import { describeAwsFailure } from "../rules/aws-failure.rules.ts";
import { ocsfEventToGovernanceRow } from "../rules/ocsf-ingest-row.rules.ts";
import {
  aiTargetOf,
  isAiActivityEvent,
  isSelectedSecurityLakeObject,
  parseSecurityLakeNotification,
  type SecurityLakeObjectRef,
  securityLakeRowToEvent,
} from "../rules/security-lake-event.rules.ts";
import { tallyWrittenRows } from "../rules/security-lake-health.rules.ts";
import {
  DEFAULT_DECODE_LIMITS,
  decodeParquetRowGroups,
  describeParquetFailure,
  isDecodeLimitError,
  type SecurityLakeDecodeLimits,
  wholeArrayBuffer,
} from "../rules/security-lake-parquet.rules.ts";

/** Security Lake rolls Parquet files every few minutes, so its files stay well under this. */
const MAX_OBJECT_BYTES = 128 * 1024 * 1024;
const SQS_RECEIVE_MAX = 10;

/**
 * How long a received message stays hidden while it is read, and how far one run may go before it
 * hands the messages it has not started back. The time budget sits under the hold, so a message
 * started inside the budget is still held when its delete is sent.
 */
export type SecurityLakeRunBudget = { maxMs: number; maxBytes: number };
const DEFAULT_RUN_BUDGET: SecurityLakeRunBudget = {
  maxMs: 4 * 60 * 1000,
  maxBytes: 1024 * 1024 * 1024,
};
export const SECURITY_LAKE_VISIBILITY_HOLD_SECONDS = 5 * 60;
const RUN_BUDGET_SPENT = "the run's time or byte budget ran out inside this notification";
/** A message left for another try comes back after this, as it would on SQS's default timeout. */
export const SECURITY_LAKE_RETRY_DELAY_SECONDS = 30;

/** An object or message the reader gave up on, for the source health. */
export type SecurityLakePoison = { messageId: string; key: string; reason: string };

export type SecurityLakeReadResult = {
  messages: number;
  objects: number;
  /** Rows decoded from the Parquet files read. */
  rows: number;
  /** AI activity events written to governance_ocsf_events. */
  written: number;
  /** Rows that are not AI activity, or are AI activity outside the selected sources. */
  dropped: number;
  invalid: number;
  deleted: number;
  /** Messages left on the queue to come back after their visibility timeout. */
  retried: number;
  poison: SecurityLakePoison[];
  /** Read time of the oldest event written, for the source's lag. */
  oldestEventTimeMs: number | undefined;
  /** The run stopped on its budget or deadline, so messages may still wait on the queue. */
  stoppedEarly: boolean;
};

type ReaderScope = { tenantId: string; sourceId: string };
/** What one run has spent of its budget, and the failed messages it holds until it ends. */
type RunProgress = { startedAtMs: number; bytes: number; retryLater: SecurityLakeQueueMessage[] };

type MessageOutcome =
  | {
      kind: "done";
      rows: GovernanceOcsfEvent[];
      objects: number;
      decoded: number;
      dropped: number;
      invalid: number;
    }
  | { kind: "retry"; key: string; reason: string; partial: DoneOutcome }
  /** Cut by a budget messages before it spent: handed back without spending a try. */
  | { kind: "deferred"; key: string; reason: string }
  | { kind: "poison"; key: string; reason: string; partial?: DoneOutcome };
type DoneOutcome = Extract<MessageOutcome, { kind: "done" }>;

/** The decoded rows a message outcome writes: all of a done message, those read before a failure. */
function findWrittenParts(outcome: Exclude<MessageOutcome, { kind: "deferred" }>): DoneOutcome[] {
  if (outcome.kind === "done") return [outcome];
  return outcome.partial === undefined ? [] : [outcome.partial];
}

/**
 * Reads one Security Lake source: polls its subscriber queue, decodes each new Parquet object,
 * keeps the AI activity and writes it to governance_ocsf_events by OCSF metadata.uid. A message
 * is deleted only after its events are written, so a crash redelivers it and the replacing
 * write collapses the repeat.
 */
export class SecurityLakeReaderService {
  private constructor(
    private readonly deps: {
      queue: SecurityLakeQueue;
      objects: GovernanceObjectStore;
      events: GovernanceOcsfEventSink;
      decodeLimits: SecurityLakeDecodeLimits;
      runBudget: SecurityLakeRunBudget;
      now: () => number;
    },
  ) {}

  static create(deps: {
    queue: SecurityLakeQueue;
    objects: GovernanceObjectStore;
    events: GovernanceOcsfEventSink;
    decodeLimits?: SecurityLakeDecodeLimits;
    runBudget?: SecurityLakeRunBudget;
    now?: () => number;
  }): SecurityLakeReaderService {
    return new SecurityLakeReaderService({
      ...deps,
      decodeLimits: deps.decodeLimits ?? DEFAULT_DECODE_LIMITS,
      runBudget: deps.runBudget ?? DEFAULT_RUN_BUDGET,
      now: deps.now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  async readOnce({
    tenantId,
    sourceId,
    config,
    credentials,
    signal,
  }: {
    tenantId: string;
    sourceId: string;
    config: SecurityLakePullConfig;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
  }): Promise<SecurityLakeReadResult> {
    const result: SecurityLakeReadResult = {
      messages: 0,
      objects: 0,
      rows: 0,
      written: 0,
      dropped: 0,
      invalid: 0,
      deleted: 0,
      retried: 0,
      poison: [],
      oldestEventTimeMs: undefined,
      stoppedEarly: false,
    };
    const target: SecurityLakeQueueTarget = {
      queueUrl: config.queueUrl,
      region: config.region,
      ...(config.sqsEndpoint === undefined ? {} : { endpoint: config.sqsEndpoint }),
      credentials,
      ...(signal === undefined ? {} : { signal }),
    };
    const seen = new Set<string>();
    const run: RunProgress = { startedAtMs: this.deps.now(), bytes: 0, retryLater: [] };

    const settle = (message: SecurityLakeQueueMessage) =>
      this.settleMessage({
        message,
        result,
        run,
        target,
        tenantId,
        sourceId,
        config,
        credentials,
        signal,
      });
    try {
      while (result.messages < config.maxMessagesPerRun) {
        if (this.isPastBudget(run) || signal?.aborted) break;
        const batch = await this.deps.queue.receive({
          ...target,
          maxMessages: Math.min(SQS_RECEIVE_MAX, config.maxMessagesPerRun - result.messages),
        });
        const fresh = batch.filter((message) => !seen.has(message.messageId));
        if (fresh.length === 0) return result;
        for (const message of fresh) seen.add(message.messageId);
        if (!(await this.settleBatch({ fresh, run, target, signal, settle }))) break;
      }
      // Any way out but an empty receive may leave messages on the queue.
      result.stoppedEarly = true;
      return result;
    } finally {
      // Held through the run, so a receive cannot skip one as seen and spend its try for nothing.
      for (const message of run.retryLater) {
        await this.setVisibility({ target, message, seconds: SECURITY_LAKE_RETRY_DELAY_SECONDS });
      }
    }
  }

  /**
   * Holds the whole batch, so a message waiting its turn is not handed out again, then settles each
   * one under a renewed hold. Past the budget the rest go back to the queue and `false` ends the run.
   */
  private async settleBatch({
    fresh,
    run,
    target,
    signal,
    settle,
  }: {
    fresh: readonly SecurityLakeQueueMessage[];
    run: RunProgress;
    target: SecurityLakeQueueTarget;
    signal: AbortSignal | undefined;
    settle: (message: SecurityLakeQueueMessage) => Promise<void>;
  }): Promise<boolean> {
    for (const message of fresh) await this.setVisibility({ target, message });
    for (const [index, message] of fresh.entries()) {
      if (this.isPastBudget(run) || signal?.aborted) {
        for (const left of fresh.slice(index))
          await this.setVisibility({ target, message: left, seconds: 0 });
        return false;
      }
      if (index > 0) await this.setVisibility({ target, message });
      await settle(message);
    }
    return true;
  }

  private isPastBudget(run: RunProgress): boolean {
    return (
      this.deps.now() - run.startedAtMs >= this.deps.runBudget.maxMs ||
      run.bytes >= this.deps.runBudget.maxBytes
    );
  }

  /** Hides a message for `seconds`, the read hold unless handed back; a refusal keeps the old hold. */
  private async setVisibility({
    target,
    message,
    seconds = SECURITY_LAKE_VISIBILITY_HOLD_SECONDS,
  }: {
    target: SecurityLakeQueueTarget;
    message: SecurityLakeQueueMessage;
    seconds?: number;
  }): Promise<void> {
    await this.deps.queue
      .changeVisibility({
        ...target,
        receiptHandle: message.receiptHandle,
        visibilityTimeoutSeconds: seconds,
      })
      .catch(() => undefined);
  }

  private async settleMessage({
    message,
    result,
    run,
    target,
    tenantId,
    sourceId,
    config,
    credentials,
    signal,
  }: {
    message: SecurityLakeQueueMessage;
    result: SecurityLakeReadResult;
    run: RunProgress;
    target: SecurityLakeQueueTarget;
    tenantId: string;
    sourceId: string;
    config: SecurityLakePullConfig;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
  }): Promise<void> {
    result.messages += 1;
    const outcome = await this.readMessage({
      message,
      scope: { tenantId, sourceId },
      run,
      config,
      credentials,
      signal,
    });
    const retry = outcome.kind === "retry" && message.receiveCount < config.maxReceives;
    if (outcome.kind === "deferred" || retry) {
      result.retried += 1;
      result.stoppedEarly = true;
      // A deferred one goes back now, as the run is over; a failed one is held until it ends.
      const deferred = outcome.kind === "deferred";
      if (!deferred) run.retryLater.push(message);
      await this.setVisibility({ target, message, ...(deferred ? { seconds: 0 } : {}) });
      return;
    }
    // Rows decoded before a failed object are written too; a rewrite on redelivery is idempotent.
    for (const written of findWrittenParts(outcome)) {
      // A failed write throws before the delete, leaving the message to come back.
      if (written.rows.length > 0) await this.deps.events.insertEvents(written.rows);
      tallyWrittenRows({ tally: result, written });
    }
    if (outcome.kind !== "done") {
      result.poison.push({
        messageId: message.messageId,
        key: outcome.key,
        reason: outcome.reason,
      });
    }
    await this.deps.queue.delete({ ...target, receiptHandle: message.receiptHandle });
    result.deleted += 1;
  }

  private async readMessage({
    message,
    scope,
    run,
    config,
    credentials,
    signal,
  }: {
    message: SecurityLakeQueueMessage;
    scope: ReaderScope;
    run: RunProgress;
    config: SecurityLakePullConfig;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
  }): Promise<MessageOutcome> {
    const notification = parseSecurityLakeNotification(message.body);
    if (notification.kind === "unreadable") {
      return { kind: "poison", key: "", reason: notification.reason };
    }
    const selected =
      notification.kind === "objects"
        ? notification.objects.filter((object) =>
            isSelectedSecurityLakeObject({ key: object.key, sources: config.sources }),
          )
        : [];
    const done: DoneOutcome = {
      kind: "done",
      rows: [],
      objects: 0,
      decoded: 0,
      dropped: 0,
      invalid: 0,
    };
    // A notification cut on a budget it did not start spends no try; alone over it, it can never fit.
    const startedFresh = run.bytes === 0;
    // A failed object does not stop the rest: their rows are kept even if the notification goes.
    let failure: { key: string; reason: string } | undefined;
    let refused: { key: string; reason: string } | undefined;
    for (const object of selected) {
      // One notification may name many objects: past the budget the rest wait for another run.
      if (this.isPastBudget(run)) {
        if (!startedFresh) return { kind: "deferred", key: object.key, reason: RUN_BUDGET_SPENT };
        failure ??= { key: object.key, reason: RUN_BUDGET_SPENT };
        break;
      }
      const read = await this.readObject({ object, scope, run, config, credentials, signal });
      if (read.kind === "failed") {
        failure ??= { key: object.key, reason: read.reason };
        continue;
      }
      if (read.kind === "refused") {
        refused ??= { key: object.key, reason: read.reason };
        continue;
      }
      done.objects += 1;
      done.decoded += read.decoded;
      done.dropped += read.dropped;
      done.invalid += read.invalid;
      done.rows.push(...read.rows);
    }
    if (failure !== undefined) return { kind: "retry", ...failure, partial: done };
    return refused === undefined ? done : { kind: "poison", ...refused, partial: done };
  }

  private async readObject({
    object,
    scope,
    run,
    config,
    credentials,
    signal,
  }: {
    object: SecurityLakeObjectRef;
    scope: ReaderScope;
    run: RunProgress;
    config: SecurityLakePullConfig;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
  }): Promise<
    | {
        kind: "read";
        rows: GovernanceOcsfEvent[];
        decoded: number;
        dropped: number;
        invalid: number;
      }
    | { kind: "failed"; reason: string }
    | { kind: "refused"; reason: string }
  > {
    const read = {
      kind: "read" as const,
      rows: [] as GovernanceOcsfEvent[],
      decoded: 0,
      dropped: 0,
      invalid: 0,
    };
    const latest = this.deps.now() + OCSF_INGEST_MAX_FUTURE_MS;
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.objects.readBytes({
        bucket: object.bucket,
        key: object.key,
        region: config.region,
        ...(config.s3Endpoint === undefined ? {} : { endpoint: config.s3Endpoint }),
        credentials,
        ...(signal === undefined ? {} : { signal }),
        maxBytes: MAX_OBJECT_BYTES,
      });
    } catch (error) {
      return { kind: "failed", reason: describeAwsFailure(error) };
    }
    run.bytes += bytes.byteLength;
    try {
      const groups = decodeParquetRowGroups({
        file: wholeArrayBuffer(bytes),
        limits: this.deps.decodeLimits,
      });
      // Each row group is mapped and let go before the next one is decoded.
      for await (const group of groups) {
        read.decoded += group.length;
        for (const raw of group) this.keepRow({ raw, scope, latest, read });
      }
    } catch (error) {
      if (isDecodeLimitError(error)) return { kind: "refused", reason: error.message };
      return { kind: "failed", reason: describeParquetFailure(error) };
    }
    return read;
  }

  /** Maps one decoded row and keeps it when it is a valid AI activity event. */
  private keepRow({
    raw,
    scope,
    latest,
    read,
  }: {
    raw: Record<string, unknown>;
    scope: ReaderScope;
    latest: number;
    read: { rows: GovernanceOcsfEvent[]; dropped: number; invalid: number };
  }): void {
    const mapped = securityLakeRowToEvent(raw);
    if (mapped.kind === "invalid" || mapped.event.time > latest) {
      read.invalid += 1;
      return;
    }
    if (!isAiActivityEvent(mapped.event)) {
      read.dropped += 1;
      return;
    }
    read.rows.push(
      ocsfEventToGovernanceRow({
        ...scope,
        sourceType: SECURITY_LAKE_SOURCE_TYPE,
        event: mapped.event,
        targetName: aiTargetOf(mapped.event),
      }),
    );
  }
}
