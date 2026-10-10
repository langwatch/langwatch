// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";
import numeral from "numeral";

import { formatBucketTick } from "./costs-window.ts";
import { SHORT_MONTHS, isIsoDay } from "./iso-day.ts";
import { type TimeInterval } from "./time-controls.ts";

/** Compact above a thousand, exact below it. Money is read, not audited, here. */
export function fmtMoney(value: number): string {
  if (value === 0) return "$0";
  if (Math.abs(value) >= 1000) return numeral(value).format("$0.[0]a");
  return numeral(value).format("$0,0.[00]");
}

export function fmtCount(value: number): string {
  return numeral(value).format("0.[0]a");
}

/**
 * A count spelled out in full, thousands separated.
 *
 * For the things a reader could in principle count: conversations, seats,
 * people. Tokens get `fmtCount` and its `k`/`M` suffixes because nobody holds
 * a token count in their head and the magnitude is the only part that matters.
 * Using the abbreviating formatter for both put "4.6k" on the conversations
 * axis directly beside "3.4B" on the tokens one, which made a few thousand
 * support chats look like a unit of machine throughput.
 */
export function fmtWhole(value: number): string {
  return numeral(value).format("0,0");
}

/**
 * The tick a bucket start reads as.
 *
 * Every time chart on this page takes the interval in view and formats its
 * axis through `formatBucketTick`, so a screen set to Quarter never draws a
 * chart ticked by day beside one ticked by quarter — two axes that look alike
 * and are not the same span is the one chart mistake a reader cannot catch.
 * A chart with no interval (nothing on this page any more; kept for the
 * daily-series case) falls back to a short `Jul 5`.
 */
export function formatDayTick(day: string | number, interval?: TimeInterval): string {
  if (interval) return formatBucketTick(day, interval);
  const iso = String(day).slice(0, 10);
  if (!isIsoDay(iso)) return String(day);
  const parsed = Temporal.PlainDate.from(iso);
  return `${SHORT_MONTHS[parsed.month - 1]} ${parsed.day}`;
}
