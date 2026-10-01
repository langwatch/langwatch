/** Derives overdue status (ADR-091); most important fact—calendar loop behind/stopped.
 * Page previously just rendered nextRunAt text. */

import { SLOT_STALE_AFTER_MS } from "@langwatch/ops-contract";
import { toEpochMs } from "@langwatch/time";

export interface SchedulerJobLike {
  nextRunAt: string | null;
  lastSlot: string | null;
  currentSlot: string | null;
  attempts: number;
  active: boolean;
}

export type SchedulerJobStatus = "paused" | "retrying" | "running" | "overdue" | "scheduled";

/** Grace period (slot leases may sit past during normal claiming). */
export const OVERDUE_GRACE_MS = 30_000;

/** No tick within this window means the calendar loop itself is the problem. */
export const LOOP_STALE_MS = 120_000;

export function deriveStatus({
  job,
  now,
}: {
  job: SchedulerJobLike;
  now: number;
}): SchedulerJobStatus {
  // Paused wins: an inactive schedule is not late, it is switched off, and
  // reporting it as overdue would bury the schedules that genuinely are.
  if (!job.active) return "paused";
  // A claimed slot with prior attempts is a job failing and retrying, not one
  // running long — the page used to show both as "In progress".
  if (job.currentSlot && job.attempts > 0) return "retrying";
  if (job.currentSlot) return "running";
  if (latenessMs({ job, now }) > OVERDUE_GRACE_MS) return "overdue";
  return "scheduled";
}

/** Milliseconds past due; zero or negative when the schedule is not late. */
export function latenessMs({ job, now }: { job: SchedulerJobLike; now: number }): number {
  if (job.nextRunAt === null) return 0;
  return now - toEpochMs(job.nextRunAt);
}

/** Statuses that mean somebody should look, in the order they should look. */
const ATTENTION_ORDER: SchedulerJobStatus[] = [
  "overdue",
  "retrying",
  "running",
  "scheduled",
  "paused",
];

export function needsAttention(status: SchedulerJobStatus): boolean {
  return status === "overdue" || status === "retrying";
}

/** Three refusals (ADR-091): no project name, paused, or running/retrying (risk
 * delivering same slot to two workers). Enforced server-side too. */
export function canRunNow({
  projectName,
  status,
}: {
  projectName: string | null;
  status: SchedulerJobStatus;
}): boolean {
  if (projectName === null) return false;
  return status !== "paused" && status !== "running" && status !== "retrying";
}

/** Whether a slot has been held long enough that clearing it is a repair. */
export function isSlotStale({
  job,
  now,
}: {
  job: SchedulerJobLike & { updatedAt?: string };
  now: number;
}): boolean {
  if (!job.currentSlot) return false;
  const heldSince = job.updatedAt ?? job.currentSlot;
  return now - toEpochMs(heldSince) >= SLOT_STALE_AFTER_MS;
}

/** Action-needed rows first, then by firing time (sooner-first matches operator reading). */
export function compareForAttention({
  a,
  b,
  now,
}: {
  a: SchedulerJobLike;
  b: SchedulerJobLike;
  now: number;
}): number {
  const rank =
    ATTENTION_ORDER.indexOf(deriveStatus({ job: a, now })) -
    ATTENTION_ORDER.indexOf(deriveStatus({ job: b, now }));
  if (rank !== 0) return rank;
  return dueAtMs(a) - dueAtMs(b);
}

export interface SchedulerHeaderCounts {
  overdue: number;
  failing: number;
  dueWithinHour: number;
  active: number;
  paused: number;
}

export function summarize({
  jobs,
  now,
}: {
  jobs: SchedulerJobLike[];
  now: number;
}): SchedulerHeaderCounts {
  const counts: SchedulerHeaderCounts = {
    overdue: 0,
    failing: 0,
    dueWithinHour: 0,
    active: 0,
    paused: 0,
  };

  for (const job of jobs) {
    tally({ counts, job, status: deriveStatus({ job, now }), now });
  }

  return counts;
}

function tally({
  counts,
  job,
  status,
  now,
}: {
  counts: SchedulerHeaderCounts;
  job: SchedulerJobLike;
  status: SchedulerJobStatus;
  now: number;
}): void {
  if (status === "paused") {
    counts.paused++;
    return;
  }
  counts.active++;
  if (status === "overdue") counts.overdue++;
  if (status === "retrying") counts.failing++;
  // Upcoming work only. A running or retrying schedule already has a slot in
  // flight, and counting it here would inflate "due soon" with work that is
  // being done — the operator is asking what is ABOUT to happen.
  if (status !== "scheduled") return;
  const until = -latenessMs({ job, now });
  if (until > 0 && until <= 3_600_000) counts.dueWithinHour++;
}

/** Loop health from schedule fire times (no heartbeat); most recent lastSlot stands
 * in for heartbeat. */
export function deriveLoopHealth({ jobs, now }: { jobs: SchedulerJobLike[]; now: number }): {
  healthy: boolean;
  lastFiredAt: number | null;
} {
  const active = jobs.filter((job) => job.active);

  const firedAts = active
    .map((job) => (job.lastSlot ? toEpochMs(job.lastSlot) : null))
    .filter((fired): fired is number => fired !== null);
  const lastFiredAt = firedAts.length > 0 ? Math.max(...firedAts) : null;

  const anythingOverdue = active.some((job) => latenessMs({ job, now }) > OVERDUE_GRACE_MS);
  if (!anythingOverdue) return { healthy: true, lastFiredAt };
  const quietFor = lastFiredAt === null ? Infinity : now - lastFiredAt;
  return { healthy: quietFor < LOOP_STALE_MS, lastFiredAt };
}

/** A paused schedule arms no next run, so it sorts after every one that does. */
function dueAtMs(job: SchedulerJobLike): number {
  return job.nextRunAt === null ? Number.POSITIVE_INFINITY : toEpochMs(job.nextRunAt);
}
