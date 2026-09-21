/**
 * Derives what the scheduler page could not say (ADR-091).
 *
 * The page rendered `nextRunAt` as ordinary text, so an overdue schedule and a
 * healthy one differed by the words "ago" and "in" buried mid-timestamp, in no
 * particular order. Overdue is the single most important fact this page can
 * carry — it means the calendar loop is behind or has stopped — so it becomes a
 * state of its own, sorts to the top, and is counted in the header.
 */

import { SLOT_STALE_AFTER_MS } from "~/shared/ops/schedulerControl";

export interface SchedulerJobLike {
  nextRunAt: string;
  lastSlot: string | null;
  currentSlot: string | null;
  attempts: number;
  active: boolean;
}

export type SchedulerJobStatus =
  | "paused"
  | "retrying"
  | "running"
  | "overdue"
  | "scheduled";

/**
 * How late a schedule may be before it counts as overdue.
 *
 * The loop leases a slot by pushing `nextRunAt` forward, so a row can sit a
 * beat in the past during normal claiming. A small grace keeps that from
 * reading as an incident every tick.
 */
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
export function latenessMs({
  job,
  now,
}: {
  job: SchedulerJobLike;
  now: number;
}): number {
  return now - new Date(job.nextRunAt).getTime();
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

/**
 * Whether run-now should be offered at all (ADR-091).
 *
 * Three refusals, each of which the server also enforces — this decides only
 * whether the operator is shown a control they could use.
 *
 * - No resolved project name: run-now is the one control that can deliver
 *   something to a customer, and a ksuid is not a target an operator can check
 *   a confirmation against.
 * - Paused: the point of pausing is that nothing runs.
 * - Running or retrying: a slot is claimed and a worker is executing it. Making
 *   the schedule due again hands the SAME slot to a second worker, because
 *   `claim()` preserves an existing `currentSlot` rather than refusing — so the
 *   target is delivered twice. This is the outcome ADR-091 declines to offer
 *   even behind a confirmation.
 */
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
  return now - new Date(heldSince).getTime() >= SLOT_STALE_AFTER_MS;
}

/**
 * Sort so the rows that need action are first, then by how soon each fires.
 *
 * Within a status, sooner-first matches how an operator reads the page: the
 * next thing to happen is the next thing to care about.
 */
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
  return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
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

/**
 * Whether the calendar loop looks alive, inferred from the schedules themselves.
 *
 * There is no heartbeat to read, so the most recent `lastSlot` across active
 * schedules stands in for one: if nothing has fired recently AND something was
 * due, the loop is the suspect rather than any individual row. With nothing
 * due, silence is expected and says nothing either way.
 */
export function deriveLoopHealth({
  jobs,
  now,
}: {
  jobs: SchedulerJobLike[];
  now: number;
}): { healthy: boolean; lastFiredAt: number | null } {
  const active = jobs.filter((job) => job.active);

  const firedAts = active
    .map((job) => (job.lastSlot ? new Date(job.lastSlot).getTime() : null))
    .filter((fired): fired is number => fired !== null);
  const lastFiredAt = firedAts.length > 0 ? Math.max(...firedAts) : null;

  const anythingOverdue = active.some(
    (job) => latenessMs({ job, now }) > OVERDUE_GRACE_MS,
  );
  if (!anythingOverdue) return { healthy: true, lastFiredAt };
  const quietFor = lastFiredAt === null ? Infinity : now - lastFiredAt;
  return { healthy: quietFor < LOOP_STALE_MS, lastFiredAt };
}
