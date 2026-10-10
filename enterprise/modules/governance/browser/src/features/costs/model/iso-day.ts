// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type Instant, Temporal } from "@langwatch/time";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Whether `iso` is a real `YYYY-MM-DD` calendar day. */
export function isIsoDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  try {
    Temporal.PlainDate.from(iso, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

/** The first of the month `months` after the month the ISO `day` falls in, as an ISO day. */
export function firstOfMonthAfter(day: string, months: number): string {
  return Temporal.PlainDate.from(day).with({ day: 1 }).add({ months }).toString();
}

/** Today's calendar day in UTC, the zone every cost read is bucketed in. */
export function utcToday(now: Instant): string {
  return now.toZonedDateTimeISO("UTC").toPlainDate().toString();
}
