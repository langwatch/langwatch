import {
  FAILED_RETROACTIVE_APPLY_PREFIX,
  PENDING_RETROACTIVE_APPLY_PREFIX,
  RETROACTIVE_APPLY_FAILURE_MESSAGE,
  RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
  type RetentionCategory,
  type RetroactiveApplyRequestedData,
  type RetroactiveCancelRequestedData,
  type RetroactiveMutationProgress,
  type RetroactiveMutationRecord,
  type RetroactiveProgressRecordedData,
} from "@langwatch/data-retention-contract";
import { Temporal } from "@langwatch/time";

import type {
  IssuedRetroactiveTargets,
  RetroactiveStatus,
} from "../repositories/retroactive-status.repository.ts";

/** How many closed request ids a status keeps: far more than a redelivery window spans. */
const CLOSED_REQUEST_IDS_KEPT = 50;
/** How many applies' issued targets a status keeps: one per category is all that can run. */
const ISSUED_APPLIES_KEPT = 10;

export type RetroactiveFact =
  | {
      id: string;
      occurredAt: number;
      type: typeof RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE;
      data: RetroactiveApplyRequestedData;
    }
  | {
      id: string;
      occurredAt: number;
      type: typeof RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE;
      data: RetroactiveCancelRequestedData;
    }
  | {
      id: string;
      occurredAt: number;
      type: typeof RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE;
      data: RetroactiveProgressRecordedData;
    };

export function emptyRetroactiveStatus({ projectId }: { projectId: string }): RetroactiveStatus {
  return {
    projectId,
    pending: [],
    mutations: [],
    failed: [],
    closedRequestIds: [],
    issued: [],
    lastAppliedEventId: "",
  };
}

export function isRetroactiveRequestOpen({
  status,
  requestId,
}: {
  status: RetroactiveStatus;
  requestId: string;
}): boolean {
  return !status.closedRequestIds.includes(requestId);
}

/** Whether a cancel names an apply the panel shows but ClickHouse never ran: pending or failed. */
export function namesUnstartedApply(mutationId: string): boolean {
  return (
    mutationId.startsWith(PENDING_RETROACTIVE_APPLY_PREFIX) ||
    mutationId.startsWith(FAILED_RETROACTIVE_APPLY_PREFIX)
  );
}

function close(status: RetroactiveStatus, requestId: string): RetroactiveStatus {
  return {
    ...status,
    pending: status.pending.filter((apply) => apply.requestId !== requestId),
    closedRequestIds: [
      ...status.closedRequestIds.filter((id) => id !== requestId),
      requestId,
    ].slice(-CLOSED_REQUEST_IDS_KEPT),
  };
}

/** Folds one fact into the status; the applied id becomes the row's version. */
export function foldRetroactiveStatus({
  status,
  fact,
}: {
  status: RetroactiveStatus;
  fact: RetroactiveFact;
}): RetroactiveStatus {
  const next = foldFact({ status, fact });
  return { ...next, lastAppliedEventId: fact.id };
}

function foldFact({
  status,
  fact,
}: {
  status: RetroactiveStatus;
  fact: RetroactiveFact;
}): RetroactiveStatus {
  switch (fact.type) {
    case RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE: {
      const { requestId, category, retentionDays } = fact.data;
      const known =
        status.closedRequestIds.includes(requestId) ||
        status.pending.some((apply) => apply.requestId === requestId);
      if (known) return status;
      return {
        ...status,
        pending: [
          ...status.pending,
          { requestId, category, retentionDays, requestedAt: fact.occurredAt },
        ],
        // Applying again replaces the category's failed apply on the panel.
        failed: status.failed.filter((failure) => failure.category !== category),
      };
    }
    case RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE: {
      const { mutationId } = fact.data;
      if (mutationId.startsWith(PENDING_RETROACTIVE_APPLY_PREFIX)) {
        return close(status, mutationId.slice(PENDING_RETROACTIVE_APPLY_PREFIX.length));
      }
      if (mutationId.startsWith(FAILED_RETROACTIVE_APPLY_PREFIX)) {
        const requestId = mutationId.slice(FAILED_RETROACTIVE_APPLY_PREFIX.length);
        return { ...status, failed: status.failed.filter((f) => f.requestId !== requestId) };
      }
      return {
        ...status,
        mutations: status.mutations.filter((mutation) => mutation.mutationId !== mutationId),
      };
    }
    case RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE: {
      const recorded = { ...status, mutations: fact.data.mutations };
      const settled = fact.data.settled;
      if (!settled) return recorded;
      const apply = status.pending.find((pending) => pending.requestId === settled.requestId);
      const failed =
        settled.outcome === "failed" && apply
          ? [
              ...recorded.failed.filter((failure) => failure.category !== apply.category),
              { requestId: apply.requestId, category: apply.category, failedAt: fact.occurredAt },
            ]
          : recorded.failed;
      return close({ ...recorded, failed }, settled.requestId);
    }
  }
}

function createTimeOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString().slice(0, 19);
}

/** Parts rewritten out of the most parts the rewrite had to do, as a whole percentage. */
export function progressPercentOf(record: RetroactiveMutationRecord): number {
  if (record.partsTotal <= 0) return 0;
  const done = Math.max(0, record.partsTotal - record.partsToDo);
  return Math.min(100, Math.max(0, Math.round((100 * done) / record.partsTotal)));
}

/**
 * What the progress read answers: the running rewrites, each apply not yet started, then each
 * apply the worker gave up on, so the panel keeps showing it until dismissed or applied again.
 */
export function progressOf(status: RetroactiveStatus): RetroactiveMutationProgress[] {
  return [
    ...status.mutations.map((record) => {
      const { partsTotal: _partsTotal, ...mutation } = record;
      return { ...mutation, progressPercent: progressPercentOf(record) };
    }),
    ...status.pending.map((apply) => ({
      mutationId: `${PENDING_RETROACTIVE_APPLY_PREFIX}${apply.requestId}`,
      table: "",
      isDone: false,
      partsToDo: 0,
      createTime: createTimeOf(apply.requestedAt),
      category: apply.category,
      progressPercent: 0,
    })),
    ...status.failed.map((failure) => ({
      mutationId: `${FAILED_RETROACTIVE_APPLY_PREFIX}${failure.requestId}`,
      table: "",
      isDone: false,
      partsToDo: 0,
      createTime: createTimeOf(failure.failedAt),
      category: failure.category,
      failure: RETROACTIVE_APPLY_FAILURE_MESSAGE,
    })),
  ];
}

/** What refuses a second apply of `category`: one of its kind waiting or running. */
export function blockingProgressOf({
  status,
  category,
}: {
  status: RetroactiveStatus;
  category: RetentionCategory;
}): RetroactiveMutationProgress[] {
  return progressOf(status).filter(
    (entry) => entry.category === category && entry.failure === undefined,
  );
}

/** A fresh read of the running rewrites, each keeping the most parts it was seen to have. */
export function recordMutations({
  before,
  read,
}: {
  before: readonly RetroactiveMutationRecord[];
  read: readonly RetroactiveMutationProgress[];
}): RetroactiveMutationRecord[] {
  return read.map(({ progressPercent: _percent, failure: _failure, ...mutation }) => {
    const seen = before.find((record) => record.mutationId === mutation.mutationId);
    return { ...mutation, partsTotal: Math.max(seen?.partsTotal ?? 0, mutation.partsToDo) };
  });
}

/** Whether two records differ in anything the panel shows. */
export function progressChanged({
  before,
  after,
}: {
  before: readonly RetroactiveMutationRecord[];
  after: readonly RetroactiveMutationRecord[];
}): boolean {
  const key = (mutations: readonly RetroactiveMutationRecord[]) =>
    mutations.map((mutation) => `${mutation.mutationId}:${mutation.partsToDo}`).join("|");
  return key(before) !== key(after);
}

/** Whether an earlier delivery of an apply began issuing its rewrites, and which it issued. */
export type IssuedTargets =
  | { kind: "not_started" }
  | { kind: "started"; targets: readonly string[] };

export function issuedTargetsOf({
  status,
  requestId,
}: {
  status: RetroactiveStatus;
  requestId: string;
}): IssuedTargets {
  const entry = status.issued.find((issued) => issued.requestId === requestId);
  return entry ? { kind: "started", targets: entry.targets } : { kind: "not_started" };
}

/** The issued list with `requestId`'s targets replaced, the oldest applies dropped. */
export function withIssuedTargets({
  issued,
  requestId,
  targets,
}: {
  issued: readonly IssuedRetroactiveTargets[];
  requestId: string;
  targets: readonly string[];
}): IssuedRetroactiveTargets[] {
  return [
    ...issued.filter((entry) => entry.requestId !== requestId),
    { requestId, targets: [...targets] },
  ].slice(-ISSUED_APPLIES_KEPT);
}
