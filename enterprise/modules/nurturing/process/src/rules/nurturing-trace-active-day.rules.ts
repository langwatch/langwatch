// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { Temporal } from "@langwatch/time";

import { utcDayOf, utcDayOffset } from "./nurturing-time.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const epochOfDay = (day: string) => Temporal.Instant.from(`${day}T00:00:00Z`).epochMilliseconds;

/**
 * How long a member's trace_active_day of one day stays claimed: well past the two days a sync
 * sends it for, so no retry, redelivery or later sync sends that day again.
 */
export const TRACE_ACTIVE_DAY_CLAIM_SECONDS = 7 * 24 * 60 * 60;

/**
 * The traced days a sync sends trace_active_day for: today's and yesterday's, so a sync just past
 * midnight still sends the day before. Older days were sent by their own syncs, and their claims
 * lapse, so sending them again could repeat one. A day before the signup day has no
 * `days_since_signup`, so it is not sent.
 */
export function traceActiveDaysToSend({
  activeDays,
  now,
  organizationCreatedAt,
}: Readonly<{
  activeDays: readonly string[];
  now: number;
  organizationCreatedAt: number;
}>): string[] {
  const yesterday = utcDayOf(now - DAY_MS);
  const signupDay = utcDayOf(organizationCreatedAt);
  return activeDays.filter((day) => day >= yesterday && day >= signupDay);
}

/** A member's trace_active_day call, with the claim that lets it out once per member and day. */
export type TraceActiveDayCall = Readonly<{ claimKey: string; call: CioBatchCall }>;

/**
 * One member's trace_active_day for a UTC day their organization traced. `days_since_signup` is
 * the `n` of the `active_day_<n>` trait the same day sets. The id is stable per member and day,
 * so Customer.io drops a repeat as well.
 */
export function traceActiveDayCall({
  userId,
  day,
  organizationCreatedAt,
}: Readonly<{ userId: string; day: string; organizationCreatedAt: number }>): TraceActiveDayCall {
  const id = `trace_active_day:${userId}:${day}`;
  return {
    claimKey: `nurturing:${id}`,
    call: {
      type: "track",
      userId,
      event: "trace_active_day",
      messageId: id,
      properties: {
        date: day,
        days_since_signup: utcDayOffset({ from: organizationCreatedAt, to: epochOfDay(day) }),
      },
    },
  };
}
