// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The failed payment recovery clock (adrs/002-failed-payment-recovery.md): day 0 is the first
 * failed charge, notices go on days 0, 3, 7, 14 and 21, and access stops 21 days in.
 */
import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import { Temporal, type Instant } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day access stops and the organization runs on Free plan limits. */
export const PAYMENT_RECOVERY_PAUSE_DAY = 21;

/** The notice days, in order; each one is sent at most once per case. */
export const PAYMENT_RECOVERY_NOTICE_DAYS = [0, 3, 7, 14, 21] as const;

export type PaymentRecoveryNoticeDay = (typeof PAYMENT_RECOVERY_NOTICE_DAYS)[number];

/** Which email a notice day sends. */
export type PaymentRecoveryNoticeKind = "failed" | "reminder" | "final" | "paused";

export type PaymentRecoveryDueNotice =
  | { kind: "due"; day: PaymentRecoveryNoticeDay }
  | { kind: "none" };

/** Whole days since day 0; the day of the first failed charge is day 0. */
export function recoveryDay({ startedAt, now }: { startedAt: Instant; now: Instant }): number {
  return Math.floor((now.epochMilliseconds - startedAt.epochMilliseconds) / DAY_MS);
}

export function accessStopsAt({ startedAt }: { startedAt: Instant }): Instant {
  return Temporal.Instant.fromEpochMilliseconds(
    startedAt.epochMilliseconds + PAYMENT_RECOVERY_PAUSE_DAY * DAY_MS,
  );
}

/** Paused is derived from the clock, never stored, so access stops on time without a sweep. */
export function isRecoveryPaused({
  startedAt,
  now,
}: {
  startedAt: Instant;
  now: Instant;
}): boolean {
  return now.epochMilliseconds >= accessStopsAt({ startedAt }).epochMilliseconds;
}

/** Whether a subscription's plan answers Free limits now; Enterprise is never paused. */
export function isPlanPausedForRecovery({
  startedAt,
  plan,
  now,
}: {
  startedAt: Instant | null | undefined;
  plan: string;
  now: Instant;
}): boolean {
  if (!startedAt || plan === PlanTypes.ENTERPRISE) return false;
  return isRecoveryPaused({ startedAt, now });
}

/** The latest notice day reached and not yet sent; a missed day sends only the latest. */
export function dueNotice({
  startedAt,
  noticeDay,
  now,
}: {
  startedAt: Instant;
  noticeDay: number | null;
  now: Instant;
}): PaymentRecoveryDueNotice {
  const day = recoveryDay({ startedAt, now });
  const sent = noticeDay ?? -1;
  const reached = PAYMENT_RECOVERY_NOTICE_DAYS.filter((each) => each <= day && each > sent);
  const latest = reached.at(-1);
  return latest === undefined ? { kind: "none" } : { kind: "due", day: latest };
}

export function noticeKindOf(day: PaymentRecoveryNoticeDay): PaymentRecoveryNoticeKind {
  if (day === 0) return "failed";
  if (day === 14) return "final";
  if (day === 21) return "paused";
  return "reminder";
}
